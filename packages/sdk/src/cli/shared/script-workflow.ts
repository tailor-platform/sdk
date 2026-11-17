/**
 * Script execution through a temporary workflow
 *
 * Synchronous script execution is bound by the platform's 60s function
 * deadline. A script that has to outlive it is registered once as a temporary
 * workflow, started once per argument, and removed when the caller is done.
 * Every start passes its argument to the job as the argument of `main`, the
 * same contract synchronous execution has.
 */

import { Code, ConnectError } from "@connectrpc/connect";
import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { recoveryContextArgs } from "#/cli/shared/args";
import { CLIError, formatCommandHint } from "#/cli/shared/errors";
import { joinFunctionLogMessages } from "#/cli/shared/function-execution";
import {
  createTemporaryWorkflow,
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
  /** Name of the owning application, recorded in the resources' labels */
  appName: string;
  /** Sentence telling how a resource left behind after a failed removal gets removed */
  leftoverNote: string;
  /** Profile the run uses, carried into the hint of a refusal so the hinted command selects it too */
  profile?: string | undefined;
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
  const { client, workspaceId, name, appName, invoker, leftoverNote, profile } = options;
  const pollInterval = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  await assertMachineUserExists({ client, workspaceId, invoker });
  await assertNoActiveScriptWorkflow({ client, workspaceId, names: [name], profile });
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

interface AssertMachineUserExistsParams {
  client: OperatorClient;
  workspaceId: string;
  invoker: ScriptInvoker;
}

/**
 * Fail before anything is registered when the machine user does not exist: the platform accepts the
 * start anyway and ends the execution before any job runs, which leaves no message naming the cause.
 * @param params - Machine user the script runs as
 */
async function assertMachineUserExists(params: AssertMachineUserExistsParams): Promise<void> {
  const { client, workspaceId, invoker } = params;
  const machineUser = await client
    .getAuthMachineUser({
      workspaceId,
      authNamespace: invoker.namespace,
      name: invoker.machineUserName,
    })
    .then((response) => response.machineUser)
    .catch((error: unknown) => {
      if (error instanceof ConnectError && error.code === Code.NotFound) return undefined;
      throw error;
    });
  if (!machineUser) {
    throw CLIError({
      code: "MACHINE_USER_NOT_FOUND",
      message: `Machine user ${invoker.machineUserName} not found in the auth namespace ${invoker.namespace}.`,
    });
  }
}

/**
 * Options for {@link assertNoActiveScriptWorkflow}
 */
export interface AssertNoActiveScriptWorkflowOptions {
  /** Operator client instance */
  client: OperatorClient;
  /** Workspace ID */
  workspaceId: string;
  /** Names of the temporary workflows to check */
  names: readonly string[];
  /** Profile the run uses, carried into the hint so the hinted command selects it too */
  profile?: string | undefined;
}

/**
 * Refuse to go on while an earlier run of one of the workflows is still executing: an interrupted
 * command leaves its chunk running on the platform, and removing the workflow under it would make
 * the chunk's outcome unknowable. A caller that deletes data before it runs a script calls this
 * first, so the refusal comes before anything is deleted.
 * @param options - Workflows to check and the workspace they live in
 */
export async function assertNoActiveScriptWorkflow(
  options: AssertNoActiveScriptWorkflowOptions,
): Promise<void> {
  const { client, workspaceId, names, profile } = options;
  for (const name of names) {
    const executions = await listTemporaryWorkflowExecutions(client, workspaceId, name);
    const active = executions.find(isExecutionActive);
    if (!active) continue;

    throw CLIError({
      code: "SCRIPT_WORKFLOW_EXECUTION_ACTIVE",
      message: `The temporary workflow '${name}' still has an execution that is running (${active.id}).`,
      suggestion:
        "An earlier command that was interrupted can still be applying its chunk. " +
        `Wait for the execution to finish (${formatCommandHint({
          command: "tailor",
          args: [
            "workflow",
            "executions",
            active.id,
            ...recoveryContextArgs({ workspaceId, profile }),
          ],
        })}), then run the command again.`,
      context: { workflowName: name, executionId: active.id },
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
      if (error instanceof ConnectError && error.code === Code.NotFound) break;
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
        error:
          "The workflow finished, but the result of its job could not be read, so it is unknown whether the script's changes were applied",
      };
    }
    return { success: true, logs, result };
  }
  const canceled = execution.status === WorkflowExecution_Status.CANCELED;
  const error =
    job?.error?.message.trim() ||
    result.trim() ||
    (canceled ? "Script execution was canceled" : "Script execution failed with unknown error");
  return { success: false, logs, result, error };
}
