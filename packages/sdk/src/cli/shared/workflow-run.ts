/**
 * Lifecycle of the temporary resources behind `tailor workflow run`
 *
 * A run registers a script as a function, a job function and a workflow, starts
 * it, and waits. The resources carry the run labels and no owner label, so a
 * deploy never claims them while a run is going.
 */

import { timestampMs } from "@bufbuild/protobuf/wkt";
import { resourceTrn, sdkAppIdLabelKey, sdkNameLabelKey } from "#/cli/commands/deploy/label";
import { recoveryContextArgs } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { formatCommandHint, isCLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { readOutcome } from "#/cli/shared/script-workflow";
import {
  createTemporaryWorkflow,
  isExecutionActive,
  isStartRefused,
  POLL_DEADLINE_EXCEEDED,
  listTemporaryWorkflowExecutions,
  pollUntilTerminal,
  teardownTemporaryWorkflow,
  uploadTemporaryFunction,
} from "#/cli/shared/temporary-workflow";
import {
  readWorkflowRunMarker,
  runIdStartedAt,
  workflowRunLabels,
  workflowRunResourceName,
  type WorkflowRunKind,
} from "#/cli/shared/workflow-run-labels";
import type { OperatorClient } from "#/cli/shared/client";
import type { ScriptExecutionResult, ScriptInvoker } from "#/cli/shared/script-executor";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import type { Jsonifiable } from "type-fest";

const SUBJECT = "workflow run";
const LEFTOVER_NOTE =
  "`tailor workflow run --cleanup` retries the removal while the workflow exists; " +
  "a function or job function left after the workflow is gone has to be removed by hand.";

/** A run that has not started is kept this long, since another process may be about to start it. */
const NOT_STARTED_GRACE_MS = 60_000;

/** A run that finished is kept this long, so the command waiting for it can still read the outcome. */
const FINISHED_GRACE_MS = 120_000;

export interface StartWorkflowRunParams {
  client: OperatorClient;
  workspaceId: string;
  runId: string;
  kind: WorkflowRunKind;
  /** Bundled script code exporting `main` */
  code: string;
  /** Description recorded on the registered function */
  description: string;
  invoker: ScriptInvoker;
  arg: Jsonifiable | undefined;
}

/** A run the platform has accepted. */
export interface StartedWorkflowRun {
  runId: string;
  /** Name shared by the run's function, job function and workflow */
  name: string;
  workflowId: string;
  executionId: string;
}

/**
 * Register the script as a temporary workflow and start it once.
 * @param params - Script, run id and argument
 * @returns The started run
 */
export async function startWorkflowRun(
  params: StartWorkflowRunParams,
): Promise<StartedWorkflowRun> {
  const { client, workspaceId, runId, kind } = params;
  const name = workflowRunResourceName(runId);
  const owner = {
    appName: undefined,
    appId: undefined,
    labels: workflowRunLabels({ kind, runId }),
  };
  const created: { workflowId?: string } = {};
  let startSent = false;
  try {
    await uploadTemporaryFunction({
      ...owner,
      client,
      workspaceId,
      name,
      code: params.code,
      description: params.description,
    });
    const workflowId = await createTemporaryWorkflow(
      { ...owner, client, workspaceId, name, jobFunctionNames: [name], subject: SUBJECT },
      created,
    );
    startSent = true;
    const { executionId } = await client.startWorkflow({
      workspaceId,
      workflowId,
      authInvoker: params.invoker,
      arg: params.arg === undefined ? undefined : JSON.stringify(params.arg),
    });
    return { runId, name, workflowId, executionId };
  } catch (error) {
    if (startSent && !isStartRefused(error)) {
      logger.warn(
        `Could not confirm that run ${runId} was not started, so its resources were kept. ` +
          "`tailor workflow run --cleanup` removes them once the run has finished.",
      );
      throw error;
    }
    await teardownTemporaryWorkflow({
      client,
      workspaceId,
      name,
      workflowId: created.workflowId,
      subject: SUBJECT,
      leftoverNote: LEFTOVER_NOTE,
    });
    throw error;
  }
}

export interface AwaitWorkflowRunParams {
  client: OperatorClient;
  workspaceId: string;
  started: StartedWorkflowRun;
  /** Poll interval in milliseconds */
  pollInterval: number;
  /** Longest wait in milliseconds */
  timeoutMs: number;
  /** Called with each poll that finds the run still going */
  onActive?: () => void;
}

export type WorkflowRunOutcome =
  | { state: "finished"; result: ScriptExecutionResult }
  | { state: "timedOut" };

/**
 * Wait for a started run. A finished run's resources are removed; a run whose
 * wait ran out is left going with its resources in place.
 * @param params - Run to wait for
 * @returns The result, or that the wait timed out
 */
export async function awaitWorkflowRun(
  params: AwaitWorkflowRunParams,
): Promise<WorkflowRunOutcome> {
  const { client, workspaceId, started, pollInterval, timeoutMs } = params;
  const deadline = Date.now() + timeoutMs;
  let execution;
  try {
    execution = await pollUntilTerminal({
      client,
      workspaceId,
      executionId: started.executionId,
      pollInterval,
      subject: "Script",
      deadline,
      options: { onActive: () => params.onActive?.() },
    });
  } catch (error) {
    if (isCLIError(error) && error.code === POLL_DEADLINE_EXCEEDED) return { state: "timedOut" };
    throw error;
  }
  const result = await readOutcome({ client, workspaceId, execution, pollInterval });
  await teardownTemporaryWorkflow({
    client,
    workspaceId,
    name: started.name,
    workflowId: started.workflowId,
    subject: SUBJECT,
    leftoverNote: LEFTOVER_NOTE,
  });
  return { state: "finished", result };
}

export interface ReclaimWorkflowRunsParams {
  client: OperatorClient;
  workspaceId: string;
  now: Date;
  /** Also remove a run that finished moments ago (an explicit `--cleanup`) */
  ignoreFinishedGrace?: boolean;
  /** Send the warning for a failed removal to the debug output only */
  quiet?: boolean;
}

/**
 * Remove the resources of runs that have finished. Runs still executing, and
 * runs created moments ago that have not started, are kept.
 * @param params - Workspace to sweep
 * @returns Names of the runs removed
 */
export async function reclaimWorkflowRuns(params: ReclaimWorkflowRunsParams): Promise<string[]> {
  const { client, workspaceId, now } = params;
  const workflows = await fetchPaged(async (pageToken, pageSize) => {
    const { workflows, nextPageToken } = await client.listWorkflows({
      workspaceId,
      pageToken,
      pageSize,
    });
    return [workflows, nextPageToken];
  }, {});

  const removed: string[] = [];
  for (const workflow of workflows) {
    if (!workflow.name.startsWith(workflowRunResourceName("r"))) continue;
    const { metadata } = await client.getMetadata({
      trn: resourceTrn(workspaceId, "workflow", workflow.name),
    });
    const labels = metadata?.labels;
    const marker = readWorkflowRunMarker(labels);
    if (!marker || workflow.name !== workflowRunResourceName(marker.runId)) continue;
    if (labels?.[sdkNameLabelKey] !== undefined || labels?.[sdkAppIdLabelKey] !== undefined) {
      continue;
    }

    const executions = await listTemporaryWorkflowExecutions(client, workspaceId, workflow.name);
    if (executions.some(isExecutionActive)) continue;
    if (executions.length === 0) {
      const createdMs = workflow.createdAt
        ? timestampMs(workflow.createdAt)
        : runIdStartedAt(marker.runId)?.getTime();
      if (createdMs !== undefined && now.getTime() - createdMs < NOT_STARTED_GRACE_MS) continue;
    }
    if (!params.ignoreFinishedGrace && finishedWithin(executions, now, FINISHED_GRACE_MS)) continue;
    const gone = await teardownTemporaryWorkflow({
      client,
      workspaceId,
      name: workflow.name,
      workflowId: workflow.id,
      subject: SUBJECT,
      leftoverNote: LEFTOVER_NOTE,
      ...(params.quiet ? { warn: (message: string) => logger.debug(message) } : {}),
    });
    if (gone) removed.push(workflow.name);
  }
  return removed;
}

function finishedWithin(executions: WorkflowExecution[], now: Date, graceMs: number): boolean {
  return executions.some(
    (execution) =>
      execution.finishedAt && now.getTime() - timestampMs(execution.finishedAt) < graceMs,
  );
}

/**
 * Remove the resources of finished runs for a caller that must not fail
 * because of it, such as `tailor deploy`.
 * @param params - Workspace to sweep
 * @returns How many runs were removed; 0 when the sweep failed
 */
export async function reclaimFinishedWorkflowRuns(
  params: ReclaimWorkflowRunsParams,
): Promise<number> {
  try {
    return (await reclaimWorkflowRuns({ ...params, quiet: true })).length;
  } catch (error) {
    logger.debug(
      `Could not sweep finished workflow runs: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  }
}

export interface WorkflowRunHintsParams {
  executionId: string;
  workspaceId: string;
  profile: string | undefined;
}

/**
 * Commands that read a run's outcome and remove its resources, written so they
 * select the workspace and profile the run used.
 * @param params - Run and the context it ran in
 * @returns The two commands, ready to copy
 */
export function workflowRunHints(params: WorkflowRunHintsParams): {
  inspect: string;
  cleanup: string;
} {
  const context = recoveryContextArgs({ workspaceId: params.workspaceId, profile: params.profile });
  return {
    inspect: formatCommandHint({
      command: "tailor",
      args: ["workflow", "executions", params.executionId, ...context],
    }),
    cleanup: formatCommandHint({
      command: "tailor",
      args: ["workflow", "run", "--cleanup", ...context],
    }),
  };
}
