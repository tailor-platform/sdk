import {
  ExecutorJobStatus,
  ExecutorTargetType,
  ExecutorTriggerType,
} from "@tailor-platform/tailor-proto/executor_resource_pb";
import { CLIError } from "#/cli/shared/errors";
import { styles } from "#/cli/shared/logger";
import {
  parseProtoEnumName,
  protoEnumLookup,
  protoEnumName,
  protoEnumNames,
} from "#/cli/shared/proto-enum";

// ============================================================================
// Executor Job Status
// ============================================================================

export type ExecutorJobStatusClass = "success" | "failure" | "transient";

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

const EXECUTOR_JOB_STATUS_CLASS = {
  [ExecutorJobStatus.UNSPECIFIED]: "transient",
  [ExecutorJobStatus.PENDING]: "transient",
  [ExecutorJobStatus.RUNNING]: "transient",
  [ExecutorJobStatus.SUCCESS]: "success",
  [ExecutorJobStatus.FAILED]: "failure",
  [ExecutorJobStatus.CANCELED]: "failure",
} satisfies Record<ExecutorJobStatus, ExecutorJobStatusClass>;

/**
 * Classify executor job status for waiter decisions.
 * @param status - Executor job status enum value
 * @returns Classified executor job status
 */
export function classifyExecutorJobStatus(status: ExecutorJobStatus): ExecutorJobStatusClass {
  // A status newer than the stubs is treated as transient, so waiting continues until the timeout.
  return protoEnumLookup(EXECUTOR_JOB_STATUS_CLASS, status, "transient");
}

/**
 * Parse executor job status string to enum.
 * @param status - Status string to parse
 * @returns ExecutorJobStatus enum value
 */
export function parseExecutorJobStatus(status: string): ExecutorJobStatus {
  const parsed = parseProtoEnumName(ExecutorJobStatus, status, [ExecutorJobStatus.UNSPECIFIED]);
  if (parsed === undefined) {
    const validValues = protoEnumNames(ExecutorJobStatus).filter((name) => name !== "UNSPECIFIED");
    throw CLIError({
      code: "EXECUTOR_STATUS_INVALID",
      message: `Invalid status: ${status}. Valid values: ${validValues.join(", ")}`,
    });
  }
  return parsed;
}

// ============================================================================
// Executor Target Type
// ============================================================================

const EXECUTOR_TARGET_TYPE_LABEL = {
  [ExecutorTargetType.UNSPECIFIED]: "UNSPECIFIED",
  [ExecutorTargetType.WEBHOOK]: "WEBHOOK",
  [ExecutorTargetType.TAILOR_GRAPHQL]: "GRAPHQL",
  [ExecutorTargetType.FUNCTION]: "FUNCTION",
  [ExecutorTargetType.JOB_FUNCTION]: "JOB_FUNCTION",
  [ExecutorTargetType.WORKFLOW]: "WORKFLOW",
} satisfies Record<ExecutorTargetType, string>;

/**
 * Convert executor target type enum to string.
 * @param targetType - Executor target type enum value
 * @returns Target type string representation
 */
export function executorTargetTypeToString(targetType: ExecutorTargetType): string {
  return protoEnumLookup(EXECUTOR_TARGET_TYPE_LABEL, targetType, "UNSPECIFIED");
}

/**
 * Convert executor trigger type enum to string.
 * @param triggerType - Executor trigger type enum value
 * @returns Trigger type string representation
 */
export function executorTriggerTypeToString(triggerType: ExecutorTriggerType): string {
  return protoEnumName(ExecutorTriggerType, triggerType) ?? "UNSPECIFIED";
}
