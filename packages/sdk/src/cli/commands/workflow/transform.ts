import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-proto/tailor/v1/workflow_resource_pb";
import type {
  Workflow,
  WorkflowExecution,
  WorkflowJobExecution,
} from "@tailor-proto/tailor/v1/workflow_resource_pb";

export interface WorkflowListInfo {
  name: string;
  mainJob: string;
  jobFunctions: number;
  updatedAt: Date | null;
}

export interface WorkflowInfo {
  name: string;
  id: string;
  mainJob: string;
  jobFunctions: Record<string, string>;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface WorkflowJobExecutionInfo {
  id: string;
  stackedJobName: string;
  status: string;
  executionId: string;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface WorkflowExecutionInfo {
  id: string;
  workflowName: string;
  status: string;
  jobExecutions: number;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/**
 * Convert a workflow execution status enum to a string.
 * @param status - Workflow execution status
 * @returns String representation of the status
 */
function workflowExecutionStatusToString(status: WorkflowExecution_Status): string {
  switch (status) {
    case WorkflowExecution_Status.PENDING:
      return "PENDING";
    case WorkflowExecution_Status.PENDING_RESUME:
      return "PENDING_RESUME";
    case WorkflowExecution_Status.RUNNING:
      return "RUNNING";
    case WorkflowExecution_Status.SUCCESS:
      return "SUCCESS";
    case WorkflowExecution_Status.FAILED:
      return "FAILED";
    case WorkflowExecution_Status.PENDING_RETRY:
      return "PENDING_RETRY";
    case WorkflowExecution_Status.WAITING:
      return "WAITING";
    default:
      return "UNSPECIFIED";
  }
}

/**
 * Convert a workflow job execution status enum to a string.
 * @param status - Workflow job execution status
 * @returns String representation of the status
 */
function workflowJobExecutionStatusToString(status: WorkflowJobExecution_Status): string {
  switch (status) {
    case WorkflowJobExecution_Status.RUNNING:
      return "RUNNING";
    case WorkflowJobExecution_Status.SUSPEND:
      return "SUSPEND";
    case WorkflowJobExecution_Status.SUCCESS:
      return "SUCCESS";
    case WorkflowJobExecution_Status.FAILED:
      return "FAILED";
    case WorkflowJobExecution_Status.WAITING:
      return "WAITING";
    default:
      return "UNSPECIFIED";
  }
}

/**
 * Convert a Workflow proto to CLI-friendly list info.
 * @param workflow - Workflow resource
 * @returns Flattened workflow list info
 */
export function toWorkflowListInfo(workflow: Workflow): WorkflowListInfo {
  return {
    name: workflow.name,
    mainJob: workflow.mainJobFunctionName,
    jobFunctions: Object.keys(workflow.jobFunctions).length,
    updatedAt: workflow.updatedAt ? timestampDate(workflow.updatedAt) : null,
  };
}

/**
 * Convert a Workflow proto to detailed workflow info for CLI output.
 * @param workflow - Workflow resource
 * @returns Detailed workflow info
 */
export function toWorkflowInfo(workflow: Workflow): WorkflowInfo {
  const jobFunctions: Record<string, string> = {};
  for (const [name, version] of Object.entries(workflow.jobFunctions)) {
    jobFunctions[name] = version.toString();
  }

  return {
    name: workflow.name,
    id: workflow.id,
    mainJob: workflow.mainJobFunctionName,
    jobFunctions: jobFunctions,
    createdAt: workflow.createdAt ? timestampDate(workflow.createdAt) : null,
    updatedAt: workflow.updatedAt ? timestampDate(workflow.updatedAt) : null,
  };
}

/**
 * Convert a WorkflowJobExecution proto to CLI-friendly job execution info.
 * @param jobExecution - Workflow job execution resource
 * @returns Flattened job execution info
 */
export function toWorkflowJobExecutionInfo(
  jobExecution: WorkflowJobExecution,
): WorkflowJobExecutionInfo {
  return {
    id: jobExecution.id,
    stackedJobName: jobExecution.stackedJobName,
    status: workflowJobExecutionStatusToString(jobExecution.status),
    executionId: jobExecution.executionId,
    startedAt: jobExecution.startedAt ? timestampDate(jobExecution.startedAt) : null,
    finishedAt: jobExecution.finishedAt ? timestampDate(jobExecution.finishedAt) : null,
  };
}

/**
 * Convert a WorkflowExecution proto to CLI-friendly execution info.
 * @param execution - Workflow execution resource
 * @returns Flattened execution info
 */
export function toWorkflowExecutionInfo(execution: WorkflowExecution): WorkflowExecutionInfo {
  return {
    id: execution.id,
    workflowName: execution.workflowName,
    status: workflowExecutionStatusToString(execution.status),
    jobExecutions: execution.jobExecutions.length,
    startedAt: execution.startedAt ? timestampDate(execution.startedAt) : null,
    finishedAt: execution.finishedAt ? timestampDate(execution.finishedAt) : null,
  };
}
