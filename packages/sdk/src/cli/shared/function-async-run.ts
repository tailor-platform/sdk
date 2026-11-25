/**
 * Lifecycle of the temporary function behind `tailor function run --async`
 *
 * A run registers the script as a function, starts that function directly as an asynchronous job,
 * and waits for its execution. The function carries the run labels and no owner label, so a deploy
 * never claims it, and `tailor workflow prune` removes it once the run has finished.
 */

import { Code, ConnectError } from "@connectrpc/connect";
import { FunctionExecution_Status } from "@tailor-platform/tailor-proto/function_resource_pb";
import { composeExecutionErrorString } from "#/cli/commands/function/logs";
import { isNotFoundError } from "#/cli/shared/client";
import {
  isFunctionExecutionTerminalStatus,
  joinFunctionLogMessages,
} from "#/cli/shared/function-execution";
import { logger } from "#/cli/shared/logger";
import { pollUntil } from "#/cli/shared/poll-until";
import { assertMachineUserExists } from "#/cli/shared/script-workflow";
import {
  isStartRefused,
  teardownTemporaryWorkflow,
  uploadTemporaryFunction,
} from "#/cli/shared/temporary-workflow";
import { formatWaitError } from "#/cli/shared/wait-error";
import { functionRunResourceName, workflowRunLabels } from "#/cli/shared/workflow-run-labels";
import type { OperatorClient } from "#/cli/shared/client";
import type { ScriptExecutionResult, ScriptInvoker } from "#/cli/shared/script-executor";
import type { Jsonifiable } from "type-fest";

const SUBJECT = "function run";
const LEFTOVER_NOTE = "`tailor workflow prune` retries the removal once the run has finished.";

export interface StartFunctionAsyncRunParams {
  client: OperatorClient;
  workspaceId: string;
  runId: string;
  /** Bundled script code exporting `main` */
  code: string;
  /** Description recorded on the registered function */
  description: string;
  invoker: ScriptInvoker;
  /** Argument of `main`; an empty object when omitted, as a synchronous run sends */
  arg: Jsonifiable | undefined;
}

/** A run the Platform has accepted. */
export interface StartedFunctionAsyncRun {
  runId: string;
  /** Name of the registered function */
  name: string;
  executionId: string;
}

/**
 * Register the script as a temporary function and start it once.
 * @param params - Script, run id and argument
 * @returns The started run
 */
export async function startFunctionAsyncRun(
  params: StartFunctionAsyncRunParams,
): Promise<StartedFunctionAsyncRun> {
  const { client, workspaceId, runId, invoker } = params;
  await assertMachineUserExists({ client, workspaceId, invoker });
  const name = functionRunResourceName(runId);
  let registered = false;
  let startSent = false;
  try {
    try {
      await uploadTemporaryFunction({
        client,
        workspaceId,
        name,
        code: params.code,
        description: params.description,
        owner: undefined,
        labels: workflowRunLabels({ runId }),
      });
    } catch (error) {
      // A name that already exists belongs to something else, which a rollback must not remove.
      registered = !(error instanceof ConnectError && error.code === Code.AlreadyExists);
      throw error;
    }
    registered = true;
    startSent = true;
    const { executionId } = await client.startJobFunction({
      workspaceId,
      scriptRef: name,
      arg: JSON.stringify(params.arg === undefined ? {} : params.arg),
      invoker,
    });
    return { runId, name, executionId };
  } catch (error) {
    if (startSent && !isStartRefused(error)) {
      logger.warn(
        `Could not confirm that run ${runId} was not started, so its function was kept. ` +
          "`tailor workflow prune` removes it once the run has finished.",
      );
      throw error;
    }
    if (registered) await removeFunction({ client, workspaceId, name });
    throw error;
  }
}

interface RemoveFunctionParams {
  client: OperatorClient;
  workspaceId: string;
  /** Name of the registered function */
  name: string;
}

async function removeFunction(params: RemoveFunctionParams): Promise<boolean> {
  return await teardownTemporaryWorkflow({
    ...params,
    workflowId: undefined,
    jobFunctionNames: [],
    functionNames: [params.name],
    subject: SUBJECT,
    leftoverNote: LEFTOVER_NOTE,
  });
}

export interface AwaitFunctionAsyncRunParams {
  client: OperatorClient;
  workspaceId: string;
  started: StartedFunctionAsyncRun;
  /** Poll interval in milliseconds */
  pollInterval: number;
  /** Longest wait in milliseconds; `Number.POSITIVE_INFINITY` waits until the run ends */
  timeoutMs: number;
}

export type FunctionAsyncRunOutcome =
  | { state: "finished"; result: ScriptExecutionResult }
  | { state: "timedOut" }
  /** The execution could not be read; its function is kept */
  | { state: "outcomeUnavailable"; reason: string };

/**
 * Wait for a started run. A finished run's function is removed; a run whose wait ran out is left
 * going with its function in place.
 * @param params - Run to wait for
 * @returns The result, or that the wait timed out or the execution could not be read
 */
export async function awaitFunctionAsyncRun(
  params: AwaitFunctionAsyncRunParams,
): Promise<FunctionAsyncRunOutcome> {
  const { client, workspaceId, started, pollInterval, timeoutMs } = params;
  const deadline = Number.isFinite(timeoutMs) ? Date.now() + timeoutMs : undefined;
  const notFound: FunctionAsyncRunOutcome = {
    state: "outcomeUnavailable",
    reason: "the execution of the run was not found",
  };
  return await pollUntil<FunctionAsyncRunOutcome>({
    pollInterval,
    deadline,
    onTimeout: () => ({ state: "timedOut" }),
    onError: (error) =>
      isNotFoundError(error)
        ? notFound
        : { state: "outcomeUnavailable", reason: formatWaitError(error) },
    read: async (signal) => {
      const request = { workspaceId, executionId: started.executionId };
      const { execution } = await (signal
        ? client.getFunctionExecution(request, { signal })
        : client.getFunctionExecution(request));
      if (!execution) return notFound;
      if (!isFunctionExecutionTerminalStatus(execution.status)) return undefined;
      const logs = joinFunctionLogMessages(execution.logEntries);
      const result = execution.result;
      const outcome: ScriptExecutionResult =
        execution.status === FunctionExecution_Status.SUCCESS
          ? { success: true, logs, result }
          : {
              success: false,
              logs,
              result,
              error:
                (execution.error ? composeExecutionErrorString(execution.error).trim() : "") ||
                result.trim() ||
                (execution.status === FunctionExecution_Status.CANCELED
                  ? "Script execution was canceled"
                  : "Script execution failed with unknown error"),
            };
      await removeFunction({ client, workspaceId, name: started.name });
      return { state: "finished", result: outcome };
    },
  });
}
