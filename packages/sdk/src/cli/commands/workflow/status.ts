import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-proto/tailor/v1/workflow_resource_pb";
import type { WorkflowExecution } from "@tailor-proto/tailor/v1/workflow_resource_pb";

export type WorkflowWaitUntil = "success" | "suspended" | "terminal";

export type WorkflowExecutionStatusClass = "success" | "suspended" | "failure" | "transient";

export interface WorkflowExecutionStatusClassification {
  statusClass: WorkflowExecutionStatusClass;
  status: WorkflowExecution_Status;
}

/**
 * Check if workflow execution status is successful.
 * @param status - Workflow execution status enum value
 * @returns True if status is success
 */
export function isWorkflowExecutionSuccessStatus(status: WorkflowExecution_Status): boolean {
  return status === WorkflowExecution_Status.SUCCESS;
}

/**
 * Check if workflow job execution status is suspended or waiting.
 * @param status - Workflow job execution status enum value
 * @returns True if status represents a wait point
 */
export function isWorkflowJobExecutionSuspendedStatus(
  status: WorkflowJobExecution_Status,
): boolean {
  return (
    status === WorkflowJobExecution_Status.SUSPEND || status === WorkflowJobExecution_Status.WAITING
  );
}

/**
 * Check if workflow execution status is suspended or waiting.
 * @param status - Workflow execution status enum value
 * @returns True if status represents a suspended execution
 */
export function isWorkflowExecutionSuspendedStatus(status: WorkflowExecution_Status): boolean {
  return (
    status === WorkflowExecution_Status.PENDING_RESUME ||
    status === WorkflowExecution_Status.WAITING
  );
}

/**
 * Check if workflow execution status is a terminal failure.
 * @param status - Workflow execution status enum value
 * @returns True if status represents failure
 */
export function isWorkflowExecutionFailureStatus(status: WorkflowExecution_Status): boolean {
  return status === WorkflowExecution_Status.FAILED;
}

/**
 * Check if workflow execution status can still progress without user action.
 * @param status - Workflow execution status enum value
 * @returns True if status is transient
 */
export function isWorkflowExecutionTransientStatus(status: WorkflowExecution_Status): boolean {
  return (
    status === WorkflowExecution_Status.UNSPECIFIED ||
    status === WorkflowExecution_Status.PENDING ||
    status === WorkflowExecution_Status.RUNNING ||
    status === WorkflowExecution_Status.PENDING_RETRY
  );
}

/**
 * Check if workflow execution status is terminal.
 * @param status - Workflow execution status enum value
 * @returns True if status is terminal
 */
export function isWorkflowExecutionTerminalStatus(status: WorkflowExecution_Status): boolean {
  return (
    isWorkflowExecutionSuccessStatus(status) ||
    isWorkflowExecutionFailureStatus(status) ||
    isWorkflowExecutionSuspendedStatus(status)
  );
}

/**
 * Classify workflow execution status for waiter decisions.
 * @param execution - Workflow execution to classify
 * @returns Classified workflow execution status
 */
export function classifyWorkflowExecutionStatus(
  execution: WorkflowExecution,
): WorkflowExecutionStatusClassification {
  if (isWorkflowExecutionTerminalStatus(execution.status)) {
    if (isWorkflowExecutionSuccessStatus(execution.status)) {
      return { statusClass: "success", status: execution.status };
    }
    if (isWorkflowExecutionFailureStatus(execution.status)) {
      return { statusClass: "failure", status: execution.status };
    }
    return { statusClass: "suspended", status: execution.status };
  }
  if (execution.jobExecutions.some((job) => isWorkflowJobExecutionSuspendedStatus(job.status))) {
    return { statusClass: "suspended", status: execution.status };
  }
  if (isWorkflowExecutionTransientStatus(execution.status)) {
    return { statusClass: "transient", status: execution.status };
  }
  return { statusClass: "transient", status: execution.status };
}

/**
 * Check if a classified workflow execution has reached the requested waiter target.
 * @param classification - Workflow execution status classification
 * @param until - Requested wait target
 * @returns True if the wait target is reached
 */
export function hasReachedWorkflowWaitTarget(
  classification: WorkflowExecutionStatusClassification,
  until: WorkflowWaitUntil,
): boolean {
  switch (until) {
    case "success":
      return classification.statusClass === "success";
    case "suspended":
      return classification.statusClass === "suspended";
    case "terminal":
      return (
        classification.statusClass === "success" ||
        classification.statusClass === "failure" ||
        classification.statusClass === "suspended"
      );
  }
}
