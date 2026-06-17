import {
  ExecutorJobStatus,
  ExecutorTargetType,
  ExecutorTriggerType,
} from "@tailor-platform/tailor-proto/executor_resource_pb";
import { FunctionExecution_Status } from "@tailor-platform/tailor-proto/function_resource_pb";
import { styles } from "#src/cli/shared/logger";

// ============================================================================
// Executor Job Status
// ============================================================================

/**
 * Colorize executor job status string.
 * @param status - Executor job status string
 * @returns Colorized status string
 */
export function colorizeExecutorJobStatus(status: string): string {
  switch (status) {
    case "PENDING":
      return styles.dim(status);
    case "RUNNING":
      return styles.info(status);
    case "SUCCESS":
      return styles.success(status);
    case "FAILED":
      return styles.error(status);
    case "CANCELED":
      return styles.warning(status);
    default:
      return status;
  }
}

/**
 * Check if executor job status is terminal.
 * @param status - Executor job status enum value
 * @returns True if status is terminal
 */
export function isExecutorJobTerminalStatus(status: ExecutorJobStatus): boolean {
  return (
    status === ExecutorJobStatus.SUCCESS ||
    status === ExecutorJobStatus.FAILED ||
    status === ExecutorJobStatus.CANCELED
  );
}

/**
 * Parse executor job status string to enum.
 * @param status - Status string to parse
 * @returns ExecutorJobStatus enum value
 */
export function parseExecutorJobStatus(status: string): ExecutorJobStatus {
  const upperStatus = status.toUpperCase();
  switch (upperStatus) {
    case "PENDING":
      return ExecutorJobStatus.PENDING;
    case "RUNNING":
      return ExecutorJobStatus.RUNNING;
    case "SUCCESS":
      return ExecutorJobStatus.SUCCESS;
    case "FAILED":
      return ExecutorJobStatus.FAILED;
    case "CANCELED":
      return ExecutorJobStatus.CANCELED;
    default:
      throw new Error(
        `Invalid status: ${status}. Valid values: PENDING, RUNNING, SUCCESS, FAILED, CANCELED`,
      );
  }
}

// ============================================================================
// Function Execution Status
// ============================================================================

/**
 * Colorize function execution status string.
 * @param status - Function execution status string
 * @returns Colorized status string
 */
export function colorizeFunctionExecutionStatus(status: string): string {
  switch (status) {
    case "RUNNING":
      return styles.info(status);
    case "SUCCESS":
      return styles.success(status);
    case "FAILED":
      return styles.error(status);
    default:
      return status;
  }
}

/**
 * Check if function execution status is terminal.
 * @param status - Function execution status enum value
 * @returns True if status is terminal
 */
export function isFunctionExecutionTerminalStatus(status: FunctionExecution_Status): boolean {
  return status === FunctionExecution_Status.SUCCESS || status === FunctionExecution_Status.FAILED;
}

// ============================================================================
// Executor Target Type
// ============================================================================

/**
 * Convert executor target type enum to string.
 * @param targetType - Executor target type enum value
 * @returns Target type string representation
 */
export function executorTargetTypeToString(targetType: ExecutorTargetType): string {
  switch (targetType) {
    case ExecutorTargetType.WEBHOOK:
      return "WEBHOOK";
    case ExecutorTargetType.TAILOR_GRAPHQL:
      return "GRAPHQL";
    case ExecutorTargetType.FUNCTION:
      return "FUNCTION";
    case ExecutorTargetType.JOB_FUNCTION:
      return "JOB_FUNCTION";
    case ExecutorTargetType.WORKFLOW:
      return "WORKFLOW";
    default:
      return "UNSPECIFIED";
  }
}

/**
 * Convert executor trigger type enum to string.
 * @param triggerType - Executor trigger type enum value
 * @returns Trigger type string representation
 */
export function executorTriggerTypeToString(triggerType: ExecutorTriggerType): string {
  switch (triggerType) {
    case ExecutorTriggerType.SCHEDULE:
      return "SCHEDULE";
    case ExecutorTriggerType.EVENT:
      return "EVENT";
    case ExecutorTriggerType.INCOMING_WEBHOOK:
      return "INCOMING_WEBHOOK";
    default:
      return "UNSPECIFIED";
  }
}
