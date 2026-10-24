/**
 * Script execution through a temporary workflow
 *
 * Synchronous script execution is bound by the platform's 60s function
 * deadline. A script that has to outlive it is registered once as a temporary
 * workflow, started once per argument, and removed when the caller is done.
 * Every start passes its argument to the job as the argument of `main`, the
 * same contract synchronous execution has.
 */

import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { resourceTrn, writeMetadataLabelsDirect } from "#/cli/commands/deploy/label";
import { getOrNull } from "#/cli/shared/client";
import { joinFunctionLogMessages } from "#/cli/shared/function-execution";
import { logger } from "#/cli/shared/logger";
import {
  createTemporaryWorkflow,
  findTemporaryWorkflowId,
  isExecutionActive,
  listTemporaryWorkflowExecutions,
  pollUntilTerminal,
  reclaimTemporaryWorkflow,
  teardownTemporaryWorkflow,
  uploadTemporaryFunction,
} from "#/cli/shared/temporary-workflow";
import { isRetryableWaitError } from "#/cli/shared/wait-error";
import type { OperatorClient } from "#/cli/shared/client";
import type { ScriptExecutionResult, ScriptInvoker } from "#/cli/shared/script-executor";
import type { CreatedTemporaryWorkflow } from "#/cli/shared/temporary-workflow";
import type { FunctionExecution } from "@tailor-platform/tailor-proto/function_resource_pb";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import type { Jsonifiable } from "type-fest";

/** Poll interval while waiting for a started script to finish. */
const POLL_INTERVAL_MS = 3000;

/** Subject of the temporary resources in messages. */
const SUBJECT = "script";

/**
 * Options for {@link withScriptWorkflow}
 */
export interface ScriptWorkflowOptions {
  /** Operator client instance */
  client: OperatorClient;
  /** Workspace ID */
  workspaceId: string;
  /**
   * Name shared by the function, job function and workflow. Stable per kind of
   * run, so a retry reclaims the leftovers of an interrupted one.
   */
  name: string;
  /** Description recorded on the registered function */
  description: string;
  /** Bundled script code exporting `main` */
  code: string;
  /** Auth invoker for the script */
  invoker: ScriptInvoker;
  /** Sentence telling how a resource left behind after a failed removal gets removed */
  leftoverNote: string;
  /** Poll interval in milliseconds (default: 3000ms) */
  pollIntervalMs?: number;
}

/**
 * Start the script with an argument and wait for it to finish.
 */
export type RunScript = (arg: Jsonifiable) => Promise<ScriptExecutionResult>;

/**
 * What `use` can ask for besides running the script.
 */
export interface RetainControls {
  /**
   * Keep the resources instead of removing them once `use` returns, and record
   * `labels` on the workflow so a later run can take the work up again. Labels
   * are subject to the platform's metadata label rules: keys and values start
   * with a lowercase letter and hold lowercase letters, digits, `_` and `-`.
   */
  retain: (labels: Record<string, string>) => void;
}

/**
 * Callback of {@link withScriptWorkflow}
 */
export type UseScriptWorkflow<T> = (run: RunScript, controls: RetainControls) => Promise<T>;

interface RunnerParams {
  client: OperatorClient;
  workspaceId: string;
  workflowId: string;
  invoker: ScriptInvoker;
  pollInterval: number;
}

function createRunner(params: RunnerParams): RunScript {
  const { client, workspaceId, workflowId, invoker, pollInterval } = params;
  return async (arg) => {
    const { executionId } = await client.startWorkflow({
      workspaceId,
      workflowId,
      authInvoker: invoker,
      arg: JSON.stringify(arg),
    });
    const execution = await pollUntilTerminal({
      client,
      workspaceId,
      executionId,
      pollInterval,
      subject: "Script",
    });
    return await readOutcome({ client, workspaceId, execution, pollInterval });
  };
}

interface UseAndFinishParams<T> {
  client: OperatorClient;
  workspaceId: string;
  name: string;
  workflowId: string;
  leftoverNote: string;
  run: RunScript;
  use: UseScriptWorkflow<T>;
  /** Wait between attempts to record labels, in milliseconds */
  retryWaitMs: number;
  /** Keep the resources when `use` throws, instead of removing them */
  keepOnError: boolean;
}

/** Attempts to record the labels of a kept workflow through transient errors. */
const RECORD_ATTEMPTS = 3;

interface RecordLabelsParams {
  client: OperatorClient;
  workspaceId: string;
  name: string;
  labels: Record<string, string>;
  retryWaitMs: number;
}

/**
 * Record labels on the kept workflow. A failure is reported, not thrown: the
 * result of the run matters more than the record that would let a later run
 * take it up again.
 * @param params - Workflow and the labels to record
 * @returns Whether the labels were recorded
 */
async function recordLabels(params: RecordLabelsParams): Promise<boolean> {
  const { client, workspaceId, name, labels, retryWaitMs } = params;
  for (let attempt = 1; attempt <= RECORD_ATTEMPTS; attempt++) {
    try {
      await writeMetadataLabelsDirect(client, {
        trn: resourceTrn(workspaceId, "workflow", name),
        labels,
      });
      return true;
    } catch (error) {
      if (attempt < RECORD_ATTEMPTS && isRetryableWaitError(error)) {
        await new Promise((resolve) => setTimeout(resolve, retryWaitMs));
        continue;
      }
      logger.warn(
        `Could not record the labels that mark the kept ${SUBJECT} workflow '${name}', so a later run cannot take it up again: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
  return false;
}

/**
 * Run `use`, then remove the resources, or keep them with the labels `use` asked
 * to record. A thrown error says nothing about what the script did, so resources
 * made for this run are removed, while resources an earlier run kept stay as they
 * were. Resources whose labels could not be recorded are removed too, since
 * nothing could find them.
 * @param params - Resources and the callback
 * @returns What `use` returned
 */
async function useAndFinish<T>(params: UseAndFinishParams<T>): Promise<T> {
  const {
    client,
    workspaceId,
    name,
    workflowId,
    leftoverNote,
    run,
    use,
    retryWaitMs,
    keepOnError,
  } = params;
  const teardown = () =>
    teardownTemporaryWorkflow({
      client,
      workspaceId,
      name,
      workflowId,
      subject: SUBJECT,
      leftoverNote,
    });

  let retained: Record<string, string> | undefined;
  let result: T;
  try {
    result = await use(run, {
      retain: (labels) => {
        retained = labels;
      },
    });
  } catch (error) {
    if (!keepOnError) await teardown();
    throw error;
  }
  if (
    retained &&
    (await recordLabels({ client, workspaceId, name, labels: retained, retryWaitMs }))
  ) {
    return result;
  }
  await teardown();
  return result;
}

/**
 * Register the script as a temporary workflow, hand `use` a function that runs
 * it once per argument, and remove the resources afterwards, whether or not
 * `use` threw. `use` can keep them instead through {@link RetainControls}.
 * @param options - Script and where to register it
 * @param use - Receives the function that starts the script
 * @returns What `use` returned
 */
export async function withScriptWorkflow<T>(
  options: ScriptWorkflowOptions,
  use: UseScriptWorkflow<T>,
): Promise<T> {
  const { client, workspaceId, name, invoker, leftoverNote } = options;
  const pollInterval = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  await reclaimTemporaryWorkflow({
    client,
    workspaceId,
    name,
    subject: SUBJECT,
    leftoverNote,
  });

  const created: CreatedTemporaryWorkflow = {};
  let workflowId: string;
  try {
    await uploadTemporaryFunction({
      client,
      workspaceId,
      name,
      code: options.code,
      description: options.description,
    });
    workflowId = await createTemporaryWorkflow(
      {
        client,
        workspaceId,
        name,
        jobFunctionNames: [name],
        subject: SUBJECT,
      },
      created,
    );
  } catch (error) {
    await teardownTemporaryWorkflow({
      client,
      workspaceId,
      name,
      workflowId: created.workflowId,
      subject: SUBJECT,
      leftoverNote,
    });
    throw error;
  }

  const run = createRunner({ client, workspaceId, workflowId, invoker, pollInterval });
  return await useAndFinish({
    client,
    workspaceId,
    name,
    workflowId,
    leftoverNote,
    run,
    use,
    retryWaitMs: pollInterval,
    keepOnError: false,
  });
}

/**
 * Parameters of {@link discardScriptWorkflow}
 */
export interface DiscardScriptWorkflowParams {
  /** Operator client instance */
  client: OperatorClient;
  /** Workspace ID */
  workspaceId: string;
  /** Name shared by the function, job function and workflow */
  name: string;
  /** Sentence telling how a resource left behind after a failed removal gets removed */
  leftoverNote: string;
}

/**
 * Remove the temporary workflow that an earlier run kept, if there is one.
 * @param params - The workflow to remove
 */
export async function discardScriptWorkflow(params: DiscardScriptWorkflowParams): Promise<void> {
  await reclaimTemporaryWorkflow({ ...params, subject: SUBJECT });
}

/**
 * A temporary workflow found by name.
 */
export interface ScriptWorkflowInspection {
  /** ID of the workflow */
  workflowId: string;
  /** Metadata labels recorded on the workflow */
  labels: Record<string, string>;
  /** ID of an execution that is still running, when there is one */
  activeExecutionId: string | undefined;
  /** ID of the newest execution, when the workflow has run */
  latestExecutionId: string | undefined;
}

/**
 * Parameters of {@link inspectScriptWorkflow}
 */
export interface InspectScriptWorkflowParams {
  /** Operator client instance */
  client: OperatorClient;
  /** Workspace ID */
  workspaceId: string;
  /** Name shared by the function, job function and workflow */
  name: string;
}

/**
 * Look up a temporary workflow that an earlier run kept.
 * @param params - Where to look
 * @returns The workflow, its labels and any running execution; undefined when no such workflow exists
 */
export async function inspectScriptWorkflow(
  params: InspectScriptWorkflowParams,
): Promise<ScriptWorkflowInspection | undefined> {
  const { client, workspaceId, name } = params;
  const workflowId = await findTemporaryWorkflowId(client, workspaceId, name);
  if (!workflowId) return undefined;

  const [metadata, executions] = await Promise.all([
    getOrNull(() => client.getMetadata({ trn: resourceTrn(workspaceId, "workflow", name) })),
    listTemporaryWorkflowExecutions(client, workspaceId, name),
  ]);
  return {
    workflowId,
    labels: metadata?.metadata?.labels ?? {},
    activeExecutionId: executions.find(isExecutionActive)?.id,
    latestExecutionId: executions[0]?.id,
  };
}

/**
 * Options for {@link withKeptScriptWorkflow}
 */
export interface KeptScriptWorkflowOptions {
  /** Operator client instance */
  client: OperatorClient;
  /** Workspace ID */
  workspaceId: string;
  /** Name shared by the function, job function and workflow */
  name: string;
  /** ID of the workflow, from {@link inspectScriptWorkflow} */
  workflowId: string;
  /** Auth invoker for the script */
  invoker: ScriptInvoker;
  /** Sentence telling how a resource left behind after a failed removal gets removed */
  leftoverNote: string;
  /** Poll interval in milliseconds (default: 3000ms) */
  pollIntervalMs?: number;
}

/**
 * Take up a temporary workflow that an earlier run kept: hand `use` a function
 * that runs its script, and remove the resources afterwards unless `use` keeps
 * them again through {@link RetainControls}. An error thrown by `use` leaves the
 * kept workflow and its labels as they were.
 * @param options - The kept workflow
 * @param use - Receives the function that starts the script
 * @returns What `use` returned
 */
export async function withKeptScriptWorkflow<T>(
  options: KeptScriptWorkflowOptions,
  use: UseScriptWorkflow<T>,
): Promise<T> {
  const { client, workspaceId, name, workflowId, invoker, leftoverNote } = options;
  const pollInterval = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const run = createRunner({ client, workspaceId, workflowId, invoker, pollInterval });
  return await useAndFinish({
    client,
    workspaceId,
    name,
    workflowId,
    leftoverNote,
    run,
    use,
    retryWaitMs: pollInterval,
    keepOnError: true,
  });
}

/** Reads of the job's function execution tried through transient errors. */
const READ_ATTEMPTS = 3;

interface ReadOutcomeParams {
  client: OperatorClient;
  workspaceId: string;
  /** Workflow execution in a terminal state */
  execution: WorkflowExecution;
  /** Wait between reads in milliseconds */
  pollInterval: number;
}

/**
 * Read the logs and result of the job that ran the script. A workflow
 * execution carries neither; both live on the job's function execution, and
 * the run's outcome is lost if they cannot be read, so a transient error is
 * retried.
 * @param params - Execution to read the outcome of
 * @returns Result in the shape synchronous execution reports
 */
async function readOutcome(params: ReadOutcomeParams): Promise<ScriptExecutionResult> {
  const { client, workspaceId, execution, pollInterval } = params;
  const executionId = execution.jobExecutions.at(-1)?.executionId;
  let job: FunctionExecution | undefined;
  for (let attempt = 1; executionId && attempt <= READ_ATTEMPTS; attempt++) {
    try {
      ({ execution: job } = await client.getFunctionExecution({ workspaceId, executionId }));
      break;
    } catch (error) {
      if (attempt === READ_ATTEMPTS || !isRetryableWaitError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }
  const logs = job ? joinFunctionLogMessages(job.logEntries) : "";
  const result = job?.result ?? "";

  if (execution.status === WorkflowExecution_Status.SUCCESS) {
    if (!job) {
      return {
        success: false,
        logs,
        result,
        executionId: execution.id,
        error:
          "The workflow finished, but the result of its job could not be read, so it is unknown whether the script's changes were applied",
      };
    }
    return { success: true, logs, result, executionId: execution.id };
  }
  const canceled = execution.status === WorkflowExecution_Status.CANCELED;
  const error =
    job?.error?.message.trim() ||
    result.trim() ||
    (canceled ? "Script execution was canceled" : "Script execution failed with unknown error");
  return { success: false, logs, result, executionId: execution.id, error };
}
