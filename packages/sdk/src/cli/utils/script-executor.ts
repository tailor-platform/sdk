/**
 * Script execution service for TestExecScript API
 *
 * Provides a reusable utility for executing scripts via the TestExecScript API
 * with polling for completion status.
 */

import { FunctionExecution_Status } from "@tailor-proto/tailor/v1/function_resource_pb";
import type { OperatorClient } from "../client";
import type { AuthInvoker } from "@tailor-proto/tailor/v1/auth_resource_pb";

/**
 * Default polling interval for script execution status in milliseconds (1 second)
 */
export const DEFAULT_POLL_INTERVAL = 1000;

/**
 * Options for script execution
 */
export interface ScriptExecutionOptions {
  /** Operator client instance */
  client: OperatorClient;
  /** Workspace ID */
  workspaceId: string;
  /** Script name (for identification) */
  name: string;
  /** Bundled script code to execute */
  code: string;
  /** Optional JSON string argument to pass to the script */
  arg?: string;
  /** Auth invoker for script execution */
  invoker: AuthInvoker;
  /** Polling interval in milliseconds (default: 1000ms) */
  pollInterval?: number;
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
 * (SUCCESS or FAILED).
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
  while (true) {
    const { execution } = await client.getFunctionExecution({
      workspaceId,
      executionId,
    });

    if (!execution) {
      throw new Error(`Execution '${executionId}' not found.`);
    }

    // Check for terminal states
    if (
      execution.status === FunctionExecution_Status.SUCCESS ||
      execution.status === FunctionExecution_Status.FAILED
    ) {
      return {
        status: execution.status,
        logs: execution.logs,
        result: execution.result,
      };
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

/**
 * Execute a script via TestExecScript API and wait for completion
 *
 * This function:
 * 1. Calls testExecScript API to start execution
 * 2. Polls getFunctionExecution until completion
 * 3. Returns structured result with success/failure status
 * @param {ScriptExecutionOptions} options - Execution options
 * @returns {Promise<ScriptExecutionResult>} Execution result
 */
export async function executeScript(
  options: ScriptExecutionOptions,
): Promise<ScriptExecutionResult> {
  const { client, workspaceId, name, code, arg, invoker, pollInterval } = options;

  // Execute the script
  const response = await client.testExecScript({
    workspaceId,
    name,
    code,
    arg: arg ?? JSON.stringify({}),
    invoker,
  });
  const executionId = response.executionId;

  // Wait for completion
  const result = await waitForExecution(client, workspaceId, executionId, pollInterval);

  if (result.status === FunctionExecution_Status.SUCCESS) {
    return {
      success: true,
      logs: result.logs,
      result: result.result,
    };
  } else {
    const errorDetails = [result.logs, result.result].filter(Boolean).join("\n");
    return {
      success: false,
      logs: result.logs,
      result: result.result,
      error: errorDetails || "Script execution failed with unknown error",
    };
  }
}
