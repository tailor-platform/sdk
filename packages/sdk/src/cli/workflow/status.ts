import { WorkflowExecution_Status } from "@tailor-proto/tailor/v1/workflow_resource_pb";
import { styles } from "../utils/logger";

export function colorizeWorkflowExecutionStatus(status: WorkflowExecution_Status): string {
  const statusText = WorkflowExecution_Status[status];
  switch (status) {
    case WorkflowExecution_Status.PENDING:
      return styles.dim(statusText);
    case WorkflowExecution_Status.PENDING_RESUME:
      return styles.warning(statusText);
    case WorkflowExecution_Status.RUNNING:
      return styles.info(statusText);
    case WorkflowExecution_Status.SUCCESS:
      return styles.success(statusText);
    case WorkflowExecution_Status.FAILED:
      return styles.error(statusText);
    default:
      return statusText;
  }
}

export function isWorkflowExecutionTerminalStatus(status: WorkflowExecution_Status): boolean {
  return (
    status === WorkflowExecution_Status.SUCCESS ||
    status === WorkflowExecution_Status.FAILED ||
    status === WorkflowExecution_Status.PENDING_RESUME
  );
}

export function parseWorkflowExecutionStatus(status: string): WorkflowExecution_Status {
  const upperStatus = status.toUpperCase();
  switch (upperStatus) {
    case "PENDING":
      return WorkflowExecution_Status.PENDING;
    case "PENDING_RESUME":
      return WorkflowExecution_Status.PENDING_RESUME;
    case "RUNNING":
      return WorkflowExecution_Status.RUNNING;
    case "SUCCESS":
      return WorkflowExecution_Status.SUCCESS;
    case "FAILED":
      return WorkflowExecution_Status.FAILED;
    default:
      throw new Error(
        `Invalid status: ${status}. Valid values: PENDING, PENDING_RESUME, RUNNING, SUCCESS, FAILED`,
      );
  }
}
