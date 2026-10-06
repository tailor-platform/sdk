import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { protoEnumLookup } from "#/cli/shared/proto-enum";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

export type WorkflowWaitUntil = "success" | "suspended" | "terminal";

export type WorkflowExecutionStatusClass = "success" | "suspended" | "failure" | "transient";

export interface WorkflowExecutionStatusClassification {
  statusClass: WorkflowExecutionStatusClass;
  status: WorkflowExecution_Status;
}

const WORKFLOW_EXECUTION_STATUS_CLASS = {
  [WorkflowExecution_Status.UNSPECIFIED]: "transient",
  [WorkflowExecution_Status.PENDING]: "transient",
  [WorkflowExecution_Status.PENDING_RESUME]: "suspended",
  [WorkflowExecution_Status.RUNNING]: "transient",
  [WorkflowExecution_Status.SUCCESS]: "success",
  [WorkflowExecution_Status.FAILED]: "failure",
  [WorkflowExecution_Status.PENDING_RETRY]: "transient",
  [WorkflowExecution_Status.WAITING]: "suspended",
  [WorkflowExecution_Status.CANCELED]: "failure",
} satisfies Record<WorkflowExecution_Status, WorkflowExecutionStatusClass>;

function classifyStatus(status: WorkflowExecution_Status): WorkflowExecutionStatusClass {
  // A status newer than the stubs is treated as transient, so waiting continues until the timeout.
  return protoEnumLookup(WORKFLOW_EXECUTION_STATUS_CLASS, status, "transient");
}

/**
 * Check if workflow job execution status is suspended or waiting.
 * @param status - Workflow job execution status enum value
 * @returns True if status represents a wait point
 */
function isWorkflowJobExecutionSuspendedStatus(status: WorkflowJobExecution_Status): boolean {
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
  return classifyStatus(status) === "suspended";
}

/**
 * Check if workflow execution status is a terminal failure.
 * @param status - Workflow execution status enum value
 * @returns True if status represents failure
 */
export function isWorkflowExecutionFailureStatus(status: WorkflowExecution_Status): boolean {
  return classifyStatus(status) === "failure";
}

/**
 * Classify workflow execution status for waiter decisions.
 * @param execution - Workflow execution to classify
 * @returns Classified workflow execution status
 */
export function classifyWorkflowExecutionStatus(
  execution: WorkflowExecution,
): WorkflowExecutionStatusClassification {
  const statusClass = classifyStatus(execution.status);
  if (statusClass !== "transient") {
    return { statusClass, status: execution.status };
  }
  if (execution.jobExecutions.some((job) => isWorkflowJobExecutionSuspendedStatus(job.status))) {
    return { statusClass: "suspended", status: execution.status };
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
