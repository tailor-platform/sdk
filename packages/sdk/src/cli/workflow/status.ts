import { WorkflowExecution_Status } from "@tailor-proto/tailor/v1/workflow_resource_pb";

/**
 * Check if workflow execution status is terminal.
 * @param status - Workflow execution status enum
 * @returns True if status is terminal
 */
export function isWorkflowExecutionTerminalStatus(status: WorkflowExecution_Status): boolean {
  return (
    status === WorkflowExecution_Status.SUCCESS ||
    status === WorkflowExecution_Status.FAILED ||
    status === WorkflowExecution_Status.PENDING_RESUME
  );
}
