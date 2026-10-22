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
import { joinFunctionLogMessages } from "#/cli/shared/function-execution";
import {
  createTemporaryWorkflow,
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
  /** Name of the owning application, recorded in the resources' labels */
  appName: string;
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
 * Register the script as a temporary workflow, hand `use` a function that runs
 * it once per argument, and remove the resources afterwards, whether or not
 * `use` threw.
 * @param options - Script and where to register it
 * @param use - Receives the function that starts the script
 * @returns What `use` returned
 */
export async function withScriptWorkflow<T>(
  options: ScriptWorkflowOptions,
  use: (run: RunScript) => Promise<T>,
): Promise<T> {
  const { client, workspaceId, name, appName, invoker, leftoverNote } = options;
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
      appName,
      appId: undefined,
    });
    workflowId = await createTemporaryWorkflow(
      {
        client,
        workspaceId,
        name,
        jobFunctionNames: [name],
        appName,
        appId: undefined,
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

  const run: RunScript = async (arg) => {
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

  try {
    return await use(run);
  } finally {
    await teardownTemporaryWorkflow({
      client,
      workspaceId,
      name,
      workflowId,
      subject: SUBJECT,
      leftoverNote,
    });
  }
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
    return { success: true, logs, result };
  }
  const canceled = execution.status === WorkflowExecution_Status.CANCELED;
  const error =
    job?.error?.message.trim() ||
    result.trim() ||
    (canceled ? "Script execution was canceled" : "Script execution failed with unknown error");
  return { success: false, logs, result, error };
}
