/**
 * Script execution service
 *
 * Provides a reusable utility for executing scripts and polling for completion.
 */

import { FunctionExecution_Status } from "@tailor-platform/tailor-proto/function_resource_pb";
import { CLIError } from "#/cli/shared/errors";
import {
  isFunctionExecutionTerminalStatus,
  joinFunctionLogMessages,
} from "#/cli/shared/function-execution";
import type { OperatorClient } from "#/cli/shared/client";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { AuthInvokerSchema } from "@tailor-platform/tailor-proto/auth_resource_pb";
import type { Jsonifiable } from "type-fest";

/** Authentication context for script execution, provided as a plain object. */
export type ScriptInvoker = MessageInitShape<typeof AuthInvokerSchema>;

/**
 * Default polling interval for script execution status in milliseconds (1 second)
 */
export const DEFAULT_POLL_INTERVAL = 1000;

/**
 * Options for script execution
 */
export interface ScriptExecutionOptions<T extends Jsonifiable = Jsonifiable> {
  /** Operator client instance */
  client: OperatorClient;
  /** Workspace ID */
  workspaceId: string;
  /** Script name (for identification) */
  name: string;
  /** Bundled script code to execute */
  code: string;
  /** Optional JSON-serializable argument to pass to the script */
  arg?: T;
  /** Auth invoker for script execution */
  invoker: ScriptInvoker;
  /** Polling interval in milliseconds (default: 1000ms) */
  pollInterval?: number;
}

/**
 * Options for {@link executeScriptReportingStart}
 */
export interface ReportingScriptExecutionOptions<
  T extends Jsonifiable = Jsonifiable,
> extends ScriptExecutionOptions<T> {
  /** Called with the execution ID once the script is accepted, before waiting for it to finish */
  onStart?: (executionId: string) => void;
}

/**
 * Result of script execution
 */
export interface ScriptExecutionResult {
  /** Whether the script executed successfully */
  success: boolean;
  /** Logs output from the script execution */
  logs: string;
  /** Result value from the script execution */
  result: string;
  /** Error message if execution failed */
  error?: string;
}

/**
 * Result from waiting for execution completion
 */
export interface ExecutionWaitResult {
  /** Execution status */
  status: FunctionExecution_Status;
  /** Logs output from the execution */
  logs: string;
  /** Result value from the execution */
  result: string;
}

/**
 * Wait for a function execution to complete
 *
 * Polls the getFunctionExecution API until the execution reaches a terminal state
 * (SUCCESS, FAILED, or CANCELED).
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {string} executionId - Execution ID to wait for
 * @param {number} [pollInterval] - Polling interval in milliseconds (default: 1000ms)
 * @returns {Promise<ExecutionWaitResult>} Execution result
 * @throws {Error} If execution is not found
 */
export async function waitForExecution(
  client: OperatorClient,
  workspaceId: string,
  executionId: string,
  pollInterval: number = DEFAULT_POLL_INTERVAL,
): Promise<ExecutionWaitResult> {
  // loop exits when the function execution reaches a terminal status
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    const { execution } = await client.getFunctionExecution({
      workspaceId,
      executionId,
    });

    if (!execution) {
      throw CLIError({
        code: "FUNCTION_EXECUTION_NOT_FOUND",
        message: `Execution '${executionId}' not found.`,
        context: { executionId },
      });
    }

    // Check for terminal states
    if (isFunctionExecutionTerminalStatus(execution.status)) {
      return {
        status: execution.status,
        logs: joinFunctionLogMessages(execution.logEntries),
        result: execution.result,
      };
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

/**
 * Execute a script and wait for completion
 *
 * This function:
 * 1. Starts the script execution
 * 2. Polls getFunctionExecution until completion
 * 3. Returns structured result with success/failure status
 * @param {ScriptExecutionOptions} options - Execution options
 * @returns {Promise<ScriptExecutionResult>} Execution result
 */
export async function executeScript<T extends Jsonifiable = Jsonifiable>(
  options: ScriptExecutionOptions<T>,
): Promise<ScriptExecutionResult> {
  return await executeScriptReportingStart(options);
}

/**
 * Execute a script and wait for completion, like {@link executeScript}, and report the
 * execution ID as soon as the script is accepted.
 * @param {ReportingScriptExecutionOptions} options - Execution options
 * @returns {Promise<ScriptExecutionResult>} Execution result
 */
export async function executeScriptReportingStart<T extends Jsonifiable = Jsonifiable>(
  options: ReportingScriptExecutionOptions<T>,
): Promise<ScriptExecutionResult> {
  const { client, workspaceId, name, code, arg, invoker, pollInterval, onStart } = options;

  // Execute the script
  const response = await client.execScript({
    workspaceId,
    name,
    code,
    arg: JSON.stringify(arg === undefined ? {} : arg),
    invoker,
  });
  const executionId = response.executionId;
  onStart?.(executionId);

  // Wait for completion
  const result = await waitForExecution(client, workspaceId, executionId, pollInterval);

  if (result.status === FunctionExecution_Status.SUCCESS) {
    return {
      success: true,
      logs: result.logs,
      result: result.result,
    };
  } else {
    return {
      success: false,
      logs: result.logs,
      result: result.result || response.result,
      error:
        result.result ||
        response.result ||
        (result.status === FunctionExecution_Status.CANCELED
          ? "Script execution was canceled"
          : "Script execution failed with unknown error"),
    };
  }
}
