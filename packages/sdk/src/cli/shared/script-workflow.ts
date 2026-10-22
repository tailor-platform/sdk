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
import type { OperatorClient } from "#/cli/shared/client";
import type { ScriptExecutionResult, ScriptInvoker } from "#/cli/shared/script-executor";
import type { CreatedTemporaryWorkflow } from "#/cli/shared/temporary-workflow";
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
  const { client, workspaceId, name, appName, invoker } = options;
  const pollInterval = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  await reclaimTemporaryWorkflow({ client, workspaceId, name, subject: SUBJECT });

  const created: CreatedTemporaryWorkflow = {};
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
    await createTemporaryWorkflow(
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
    });
    throw error;
  }
  const workflowId = created.workflowId;
  if (!workflowId) {
    throw new Error(`Temporary ${SUBJECT} workflow '${name}' was created without an id.`);
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
    return await readOutcome(client, workspaceId, execution);
  };

  try {
    return await use(run);
  } finally {
    await teardownTemporaryWorkflow({ client, workspaceId, name, workflowId, subject: SUBJECT });
  }
}

/**
 * Read the logs and result of the job that ran the script. A workflow
 * execution carries neither; both live on the job's function execution.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param execution - Workflow execution in a terminal state
 * @returns Result in the shape synchronous execution reports
 */
async function readOutcome(
  client: OperatorClient,
  workspaceId: string,
  execution: WorkflowExecution,
): Promise<ScriptExecutionResult> {
  const executionId = execution.jobExecutions.at(-1)?.executionId;
  const { execution: job } = executionId
    ? await client.getFunctionExecution({ workspaceId, executionId })
    : { execution: undefined };
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
