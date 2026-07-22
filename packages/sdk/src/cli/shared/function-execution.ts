import { FunctionExecution_Status } from "@tailor-platform/tailor-proto/function_resource_pb";

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
