/**
 * Lifecycle of the temporary resources behind `tailor workflow run`
 *
 * A run registers a script as a function, a job function and a workflow, starts
 * it, and waits. The resources carry the run labels and no owner label, so a
 * deploy never claims them while a run is going.
 */

import { timestampMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { FunctionExecution_Status } from "@tailor-platform/tailor-proto/function_resource_pb";
import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { resourceTrn, sdkAppIdLabelKey, sdkNameLabelKey } from "#/cli/commands/deploy/label";
import { recoveryContextArgs } from "#/cli/shared/args";
import { fetchPaged, getOrNull, isNotFoundError } from "#/cli/shared/client";
import { CLIError, formatCommandHint, isCLIError } from "#/cli/shared/errors";
import { joinFunctionLogMessages } from "#/cli/shared/function-execution";
import { logger } from "#/cli/shared/logger";
import {
  assertMachineUserExists,
  mainJobExecutionId,
  readOutcome,
} from "#/cli/shared/script-workflow";
import {
  createTemporaryWorkflow,
  isExecutionActive,
  isStartRefused,
  POLL_DEADLINE_EXCEEDED,
  listTemporaryWorkflowExecutions,
  pollUntilTerminal,
  teardownTemporaryWorkflow,
  uploadTemporaryFunction,
  type CreatedTemporaryWorkflow,
} from "#/cli/shared/temporary-workflow";
import { isRetryableWaitError } from "#/cli/shared/wait-error";
import {
  isWorkflowRunResourceName,
  readWorkflowRunMarker,
  runIdStartedAt,
  workflowRunJobFunctionName,
  workflowRunLabels,
  workflowRunResourceName,
} from "#/cli/shared/workflow-run-labels";
import type { OperatorClient } from "#/cli/shared/client";
import type { ScriptExecutionResult, ScriptInvoker } from "#/cli/shared/script-executor";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import type { Jsonifiable } from "type-fest";

const SUBJECT = "workflow run";
const LEFTOVER_NOTE = "`tailor workflow cleanup` retries the removal once the run has finished.";

/** A run that has not started is kept this long, since another process may be about to start it. */
const NOT_STARTED_GRACE_MS = 60_000;

/** A run that finished is kept this long, so the command waiting for it can still read the outcome. */
const FINISHED_GRACE_MS = 5 * 60_000;

/** Longest time spent reading the result of a run that has already finished. */
const OUTCOME_READ_TIMEOUT_MS = 60_000;

/** Longest poll interval a waiter may use: it must poll again well within {@link FINISHED_GRACE_MS}. */
const MAX_POLL_INTERVAL_MS = 60_000;

interface StartWorkflowRunBaseParams {
  client: OperatorClient;
  workspaceId: string;
  runId: string;
  /** Description recorded on the registered functions */
  description: string;
  invoker: ScriptInvoker;
  arg: Jsonifiable | undefined;
}

/** A script that exports `main`, run whole. */
interface ScriptRunParams extends StartWorkflowRunBaseParams {
  kind: "script";
  /** Bundled script code exporting `main` */
  code: string;
}

/** A workflow job together with the jobs it starts. */
interface JobRunParams extends StartWorkflowRunBaseParams {
  kind: "job";
  /** Job the workflow starts with */
  mainJobName: string;
  /** Every job the run needs, the main one included, each bundled to start the others by their run names */
  jobs: readonly { jobName: string; code: string }[];
}

export type StartWorkflowRunParams = ScriptRunParams | JobRunParams;

/** A run the platform has accepted. */
export interface StartedWorkflowRun {
  runId: string;
  /** Name of the run's workflow */
  name: string;
  /** Names of the run's functions; each function has a job function of the same name */
  functionNames: string[];
  workflowId: string;
  executionId: string;
}

interface RunFunction {
  name: string;
  code: string;
}

function runFunctions(params: StartWorkflowRunParams): {
  functions: RunFunction[];
  mainFunctionName: string;
} {
  if (params.kind === "script") {
    const name = workflowRunResourceName(params.runId);
    return { functions: [{ name, code: params.code }], mainFunctionName: name };
  }
  return {
    functions: params.jobs.map(({ jobName, code }) => ({
      name: workflowRunJobFunctionName(params.runId, jobName),
      code,
    })),
    mainFunctionName: workflowRunJobFunctionName(params.runId, params.mainJobName),
  };
}

/**
 * Register the script, or the job and the jobs it starts, as a temporary
 * workflow and start it once.
 * @param params - Script or jobs, run id and argument
 * @returns The started run
 */
export async function startWorkflowRun(
  params: StartWorkflowRunParams,
): Promise<StartedWorkflowRun> {
  const { client, workspaceId, runId, kind } = params;
  await assertMachineUserExists({ client, workspaceId, invoker: params.invoker });
  const name = workflowRunResourceName(runId);
  const { functions, mainFunctionName } = runFunctions(params);
  const functionNames = functions.map((item) => item.name);
  const owner = {
    appName: undefined,
    appId: undefined,
    labels: workflowRunLabels({ kind, runId }),
  };
  const created: CreatedTemporaryWorkflow = {};
  const uploaded: string[] = [];
  let startSent = false;
  try {
    for (const item of functions) {
      try {
        await uploadTemporaryFunction({
          ...owner,
          client,
          workspaceId,
          name: item.name,
          code: item.code,
          description: params.description,
        });
      } catch (error) {
        // A name that already exists belongs to something else, which a rollback must not remove.
        if (!(error instanceof ConnectError && error.code === Code.AlreadyExists)) {
          uploaded.push(item.name);
        }
        throw error;
      }
      uploaded.push(item.name);
    }
    const workflowId = await createTemporaryWorkflow(
      {
        ...owner,
        client,
        workspaceId,
        name,
        jobFunctionNames: functionNames,
        scriptRefs: Object.fromEntries(functionNames.map((item) => [item, item])),
        mainJobFunctionName: mainFunctionName,
        subject: SUBJECT,
      },
      created,
    );
    startSent = true;
    const { executionId } = await client.startWorkflow({
      workspaceId,
      workflowId,
      authInvoker: params.invoker,
      arg: params.arg === undefined ? undefined : JSON.stringify(params.arg),
    });
    return { runId, name, functionNames, workflowId, executionId };
  } catch (error) {
    if (startSent && !isStartRefused(error)) {
      logger.warn(
        `Could not confirm that run ${runId} was not started, so its resources were kept. ` +
          "`tailor workflow cleanup` removes them once the run has finished.",
      );
      throw error;
    }
    await teardownTemporaryWorkflow({
      client,
      workspaceId,
      name,
      workflowId: created.workflowId,
      jobFunctionNames: created.jobFunctionNames ?? [],
      functionNames: uploaded,
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
  /** Longest time in milliseconds to spend reading the result of a finished run */
  outcomeTimeoutMs?: number;
}

export type WorkflowRunOutcome =
  | { state: "finished"; result: ScriptExecutionResult }
  | { state: "timedOut" }
  /** The run ended, but its result could not be read; the resources are kept */
  | {
      state: "outcomeUnavailable";
      reason: string;
      /** Whether the workflow was removed, so its execution can no longer be read through it */
      workflowRemoved: boolean;
    };

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
  let jobExecutionId: string | undefined;
  try {
    execution = await pollUntilTerminal({
      client,
      workspaceId,
      executionId: started.executionId,
      pollInterval,
      subject: "Script",
      deadline,
      options: {
        onActive: (active) => {
          jobExecutionId = mainJobExecutionId(active) ?? jobExecutionId;
          params.onActive?.();
        },
      },
    });
  } catch (error) {
    if (isCLIError(error) && error.code === POLL_DEADLINE_EXCEEDED) return { state: "timedOut" };
    // A sweep may remove the workflow of a finished run before this waiter looks again. The job's
    // own execution outlives it, so the result is still there if its id was seen while waiting.
    if (isNotFoundError(error)) {
      return await outcomeAfterWorkflowRemoved({
        client,
        workspaceId,
        jobExecutionId,
        pollInterval,
        deadline,
      });
    }
    throw error;
  }
  let result: ScriptExecutionResult;
  try {
    result = await readOutcome({
      client,
      workspaceId,
      execution,
      pollInterval,
      deadline: Date.now() + (params.outcomeTimeoutMs ?? OUTCOME_READ_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      state: "outcomeUnavailable",
      reason: error instanceof Error ? error.message : String(error),
      workflowRemoved: false,
    };
  }
  // A succeeded workflow whose script is reported as failed only means the job result was unreadable.
  if (execution.status === WorkflowExecution_Status.SUCCESS && !result.success) {
    return {
      state: "outcomeUnavailable",
      reason: result.error ?? "the job result is missing",
      workflowRemoved: false,
    };
  }
  await teardownTemporaryWorkflow({
    client,
    workspaceId,
    name: started.name,
    workflowId: started.workflowId,
    jobFunctionNames: started.functionNames,
    functionNames: started.functionNames,
    subject: SUBJECT,
    leftoverNote: LEFTOVER_NOTE,
  });
  return { state: "finished", result };
}

interface OutcomeAfterRemovalParams {
  client: OperatorClient;
  workspaceId: string;
  jobExecutionId: string | undefined;
  /** Wait between reads in milliseconds */
  pollInterval: number;
  /** Epoch milliseconds after which reading stops */
  deadline: number;
}

/**
 * Read the result of a run whose workflow was removed while this command waited,
 * following the job's own execution until it ends.
 * @param params - Job execution to follow and how long to follow it
 * @returns The result, or that it is unavailable because the workflow is gone
 */
async function outcomeAfterWorkflowRemoved(
  params: OutcomeAfterRemovalParams,
): Promise<WorkflowRunOutcome> {
  const { client, workspaceId, jobExecutionId, pollInterval, deadline } = params;
  const unavailable = (reason: string): WorkflowRunOutcome => ({
    state: "outcomeUnavailable",
    reason,
    workflowRemoved: true,
  });
  if (!jobExecutionId) {
    return unavailable("the workflow was removed before the job of the run was seen");
  }
  // loop exits when the job reaches a terminal status or the deadline passes
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    let signal: AbortSignal | undefined;
    try {
      const budget = deadline - Date.now();
      if (budget <= 0) return unavailable("the job was still running when the wait ended");
      signal = AbortSignal.timeout(budget);
      const { execution: job } = await client.getFunctionExecution(
        { workspaceId, executionId: jobExecutionId },
        { signal },
      );
      if (!job) return unavailable("the job execution of the run could not be found");
      const logs = joinFunctionLogMessages(job.logEntries);
      const result = job.result;
      if (job.status === FunctionExecution_Status.SUCCESS) {
        return { state: "finished", result: { success: true, logs, result } };
      }
      if (
        job.status === FunctionExecution_Status.FAILED ||
        job.status === FunctionExecution_Status.CANCELED
      ) {
        const canceled = job.status === FunctionExecution_Status.CANCELED;
        const error =
          job.error?.message.trim() ||
          result.trim() ||
          (canceled
            ? "Script execution was canceled"
            : "Script execution failed with unknown error");
        return { state: "finished", result: { success: false, logs, result, error } };
      }
    } catch (error) {
      // The signal fires on the deadline, but its timer can run a few milliseconds ahead of the clock.
      if (signal?.aborted) return unavailable("reading the job of the run did not finish in time");
      if (!isRetryableWaitError(error)) {
        return unavailable(error instanceof Error ? error.message : String(error));
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return unavailable("the job was still running when the wait ended");
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollInterval, remaining)));
  }
}

export interface ReclaimWorkflowRunsParams {
  client: OperatorClient;
  workspaceId: string;
  now: Date;
  /** Also remove a run that finished moments ago (an explicit `workflow cleanup`) */
  ignoreFinishedGrace?: boolean;
  /** Also remove resources named like a run's that carry no run label */
  includeUnlabeled?: boolean;
  /** Send the warning for a failed removal to the debug output only */
  quiet?: boolean;
}

/** Kind of a resource a run registers. */
type RunResourceKind = "workflow" | "job function" | "function";

/** A resource in the namespace of the temporary resources that carries no run label. */
interface UnlabeledResource {
  kind: RunResourceKind;
  name: string;
}

export interface ReclaimResult {
  /** Names of the runs whose resources were removed */
  removed: string[];
  /** Unlabeled resources found and left in place */
  keptUnlabeled: UnlabeledResource[];
  /** Unlabeled resources removed because `includeUnlabeled` was set */
  removedUnlabeled: UnlabeledResource[];
}

interface RunResource {
  kind: RunResourceKind;
  name: string;
  /** Workflow id; only a workflow has one */
  id?: string;
  createdMs: number | undefined;
  labels: Record<string, string>;
}

interface RunResources {
  workflow?: RunResource;
  jobFunctions: RunResource[];
  functions: RunResource[];
}

const METADATA_KIND: Record<
  RunResourceKind,
  "workflow" | "workflow_job_function" | "function_registry"
> = {
  workflow: "workflow",
  "job function": "workflow_job_function",
  function: "function_registry",
};

async function listRunResources(client: OperatorClient, workspaceId: string) {
  const [workflows, jobFunctions, functions] = await Promise.all([
    fetchPaged(async (pageToken, pageSize) => {
      const { workflows, nextPageToken } = await client.listWorkflows({
        workspaceId,
        pageToken,
        pageSize,
      });
      return [workflows, nextPageToken];
    }, {}),
    fetchPaged(async (pageToken, pageSize) => {
      const { jobFunctions, nextPageToken } = await client.listWorkflowJobFunctions({
        workspaceId,
        pageToken,
        pageSize,
      });
      return [jobFunctions, nextPageToken];
    }, {}),
    fetchPaged(async (pageToken, pageSize) => {
      const { functions, nextPageToken } = await client.listFunctionRegistries({
        workspaceId,
        pageToken,
        pageSize,
      });
      return [functions, nextPageToken];
    }, {}),
  ]);
  const listed: Omit<RunResource, "labels">[] = [
    ...workflows.map((item) => ({
      kind: "workflow" as const,
      name: item.name,
      id: item.id,
      createdMs: item.createdAt ? timestampMs(item.createdAt) : undefined,
    })),
    ...jobFunctions.map((item) => ({
      kind: "job function" as const,
      name: item.name,
      createdMs: item.createdAt ? timestampMs(item.createdAt) : undefined,
    })),
    ...functions.map((item) => ({
      kind: "function" as const,
      name: item.name,
      createdMs: item.createdAt ? timestampMs(item.createdAt) : undefined,
    })),
  ].filter((item) => isWorkflowRunResourceName(item.name));

  const resources: RunResource[] = [];
  for (const item of listed) {
    const response = await getOrNull(() =>
      client.getMetadata({ trn: resourceTrn(workspaceId, METADATA_KIND[item.kind], item.name) }),
    );
    if (!response) continue;
    resources.push({ ...item, labels: response.metadata?.labels ?? {} });
  }
  return resources;
}

function belongsToRun(resource: RunResource, runId: string): boolean {
  const runName = workflowRunResourceName(runId);
  if (resource.kind === "workflow") return resource.name === runName;
  return resource.name === runName || resource.name.startsWith(`${runName}-`);
}

/**
 * Remove the resources of runs that have finished. Runs still executing, and
 * runs created moments ago that have not started, are kept. Resources in the
 * namespace of the temporary resources that carry no run label are reported,
 * and removed only when asked.
 * @param params - Workspace to sweep
 * @returns The runs removed and the unlabeled resources found
 */
export async function reclaimWorkflowRuns(
  params: ReclaimWorkflowRunsParams,
): Promise<ReclaimResult> {
  const { client, workspaceId, now } = params;
  const warn = params.quiet ? (message: string) => logger.debug(message) : undefined;
  const result: ReclaimResult = { removed: [], keptUnlabeled: [], removedUnlabeled: [] };

  const runs = new Map<string, RunResources>();
  const unlabeled: RunResource[] = [];
  for (const resource of await listRunResources(client, workspaceId)) {
    if (
      resource.labels[sdkNameLabelKey] !== undefined ||
      resource.labels[sdkAppIdLabelKey] !== undefined
    ) {
      continue;
    }
    const marker = readWorkflowRunMarker(resource.labels);
    if (!marker) {
      unlabeled.push(resource);
      continue;
    }
    if (!belongsToRun(resource, marker.runId)) continue;
    const run = runs.get(marker.runId) ?? { jobFunctions: [], functions: [] };
    if (resource.kind === "workflow") run.workflow = resource;
    else if (resource.kind === "job function") run.jobFunctions.push(resource);
    else run.functions.push(resource);
    runs.set(marker.runId, run);
  }

  for (const [runId, run] of [...runs].toSorted(([a], [b]) => a.localeCompare(b))) {
    const name = workflowRunResourceName(runId);
    // The workflow may have lost its label while the functions kept theirs, so ask by name.
    const executions = await listTemporaryWorkflowExecutions(client, workspaceId, name);
    if (executions.some(isExecutionActive)) continue;
    if (executions.length === 0) {
      const createdMs = latestCreatedMs([
        ...(run.workflow ? [run.workflow] : []),
        ...run.jobFunctions,
        ...run.functions,
      ]);
      const startedMs = createdMs ?? runIdStartedAt(runId)?.getTime();
      if (startedMs !== undefined && now.getTime() - startedMs < NOT_STARTED_GRACE_MS) continue;
    }
    if (!params.ignoreFinishedGrace && finishedWithin(executions, now, FINISHED_GRACE_MS)) continue;
    const gone = await teardownTemporaryWorkflow({
      client,
      workspaceId,
      name,
      workflowId: run.workflow?.id,
      jobFunctionNames: run.jobFunctions.map((item) => item.name),
      functionNames: run.functions.map((item) => item.name),
      subject: SUBJECT,
      leftoverNote: LEFTOVER_NOTE,
      ...(warn ? { warn } : {}),
    });
    if (gone) result.removed.push(name);
  }

  const byKind = (kind: RunResourceKind) => unlabeled.filter((item) => item.kind === kind);
  // The job functions and functions of a workflow that is kept are kept with it.
  const keptWorkflows: string[] = [];
  const dependsOnKeptWorkflow = (name: string) =>
    keptWorkflows.some((workflow) => name === workflow || name.startsWith(`${workflow}-`));
  // A workflow goes before the job functions it uses, and those before their functions.
  for (const resource of [
    ...byKind("workflow"),
    ...byKind("job function"),
    ...byKind("function"),
  ]) {
    if (resource.kind !== "workflow" && dependsOnKeptWorkflow(resource.name)) continue;
    if (
      resource.createdMs !== undefined &&
      now.getTime() - resource.createdMs < NOT_STARTED_GRACE_MS
    ) {
      if (resource.kind === "workflow") keptWorkflows.push(resource.name);
      continue;
    }
    if (resource.kind === "workflow") {
      const executions = await listTemporaryWorkflowExecutions(client, workspaceId, resource.name);
      if (executions.some(isExecutionActive)) {
        keptWorkflows.push(resource.name);
        continue;
      }
    }
    const listed = { kind: resource.kind, name: resource.name };
    if (!params.includeUnlabeled) {
      result.keptUnlabeled.push(listed);
      continue;
    }
    const gone = await teardownTemporaryWorkflow({
      client,
      workspaceId,
      name: resource.name,
      workflowId: resource.id,
      jobFunctionNames: resource.kind === "job function" ? [resource.name] : [],
      functionNames: resource.kind === "function" ? [resource.name] : [],
      subject: SUBJECT,
      leftoverNote: LEFTOVER_NOTE,
      ...(warn ? { warn } : {}),
    });
    if (gone) result.removedUnlabeled.push(listed);
  }
  return result;
}

function latestCreatedMs(resources: readonly RunResource[]): number | undefined {
  const times = resources.flatMap((item) => (item.createdMs === undefined ? [] : [item.createdMs]));
  return times.length === 0 ? undefined : Math.max(...times);
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
 * @returns What the sweep found and removed; undefined when the sweep failed
 */
export async function reclaimFinishedWorkflowRuns(
  params: ReclaimWorkflowRunsParams,
): Promise<ReclaimResult | undefined> {
  try {
    return await reclaimWorkflowRuns({ ...params, quiet: true });
  } catch (error) {
    logger.debug(
      `Could not sweep finished workflow runs: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/**
 * Refuse a poll interval so long that a finished run could be removed before
 * its waiter polls again.
 * @param intervalMs - Poll interval in milliseconds
 */
export function assertPollInterval(intervalMs: number): void {
  if (intervalMs <= MAX_POLL_INTERVAL_MS) return;
  throw CLIError({
    code: "WORKFLOW_RUN_INTERVAL_TOO_LONG",
    message: `The poll interval must not exceed ${MAX_POLL_INTERVAL_MS / 1000}s.`,
    suggestion:
      "Use a shorter --interval: a finished run is only kept for a few minutes, " +
      "so a waiter polling less often could lose its result.",
    command: "workflow run",
  });
}

/**
 * Refuse an argument the platform cannot start a workflow with: it accepts a
 * JSON object or `null`, and ends the execution without a message otherwise.
 * @param value - Argument parsed from `--arg` or `--arg-file`
 */
export function assertWorkflowArg(value: Jsonifiable | undefined): void {
  if (value === undefined || value === null) return;
  if (typeof value === "object" && !Array.isArray(value)) return;
  throw CLIError({
    code: "WORKFLOW_RUN_ARG_NOT_OBJECT",
    message: "The argument of a workflow run must be a JSON object.",
    suggestion:
      "Wrap the value in an object, for example --arg '{\"value\":5}'. " +
      "`function run` accepts any JSON value; `workflow run` does not.",
    command: "workflow run",
  });
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
      args: ["workflow", "executions", params.executionId, "--logs", ...context],
    }),
    cleanup: formatCommandHint({
      command: "tailor",
      args: ["workflow", "cleanup", ...context],
    }),
  };
}
