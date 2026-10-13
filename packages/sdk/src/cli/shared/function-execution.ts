import {
  FunctionExecution_Status,
  type FunctionLogEntry,
} from "@tailor-platform/tailor-proto/function_resource_pb";

/**
 * Convert function execution status enum to string.
 * @param status - Function execution status enum value
 * @returns Status string representation
 */
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

/**
 * Join the messages of structured log entries into newline-delimited text.
 * @param logEntries - Log entries from a function execution
 * @returns Messages joined with newlines, empty when there are no entries
 */
export function joinFunctionLogMessages(logEntries: readonly FunctionLogEntry[]): string {
  return logEntries.map((entry) => entry.message).join("\n");
}
