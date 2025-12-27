import {
  ExecutorJobStatus,
  ExecutorTargetType,
} from "@tailor-proto/tailor/v1/executor_resource_pb";
import { FunctionExecution_Status } from "@tailor-proto/tailor/v1/function_resource_pb";
import { styles } from "../utils/logger";

// ============================================================================
// Executor Job Status
// ============================================================================

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

export function isExecutorJobTerminalStatus(status: ExecutorJobStatus): boolean {
  return (
    status === ExecutorJobStatus.SUCCESS ||
    status === ExecutorJobStatus.FAILED ||
    status === ExecutorJobStatus.CANCELED
  );
}

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

export function isFunctionExecutionTerminalStatus(status: FunctionExecution_Status): boolean {
  return status === FunctionExecution_Status.SUCCESS || status === FunctionExecution_Status.FAILED;
}

export function functionExecutionStatusToString(status: FunctionExecution_Status): string {
  switch (status) {
    case FunctionExecution_Status.RUNNING:
      return "RUNNING";
    case FunctionExecution_Status.SUCCESS:
      return "SUCCESS";
    case FunctionExecution_Status.FAILED:
      return "FAILED";
    default:
      return "UNSPECIFIED";
  }
}

// ============================================================================
// Executor Target Type
// ============================================================================

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
