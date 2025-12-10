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
  updatedAt: string;
}

export interface WorkflowInfo {
  name: string;
  id: string;
  mainJob: string;
  jobFunctions: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowJobExecutionInfo {
  id: string;
  stackedJobName: string;
  status: string;
  executionId: string;
  startedAt: string;
  finishedAt: string;
}

export interface WorkflowExecutionInfo {
  id: string;
  workflowName: string;
  status: string;
  jobExecutions: number;
  startedAt: string;
  finishedAt: string;
}

export function workflowExecutionStatusToString(
  status: WorkflowExecution_Status,
): string {
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
    default:
      return "UNSPECIFIED";
  }
}

export function workflowJobExecutionStatusToString(
  status: WorkflowJobExecution_Status,
): string {
  switch (status) {
    case WorkflowJobExecution_Status.RUNNING:
      return "RUNNING";
    case WorkflowJobExecution_Status.SUSPEND:
      return "SUSPEND";
    case WorkflowJobExecution_Status.SUCCESS:
      return "SUCCESS";
    case WorkflowJobExecution_Status.FAILED:
      return "FAILED";
    default:
      return "UNSPECIFIED";
  }
}

export function toWorkflowListInfo(workflow: Workflow): WorkflowListInfo {
  return {
    name: workflow.name,
    mainJob: workflow.mainJobFunctionName,
    jobFunctions: Object.keys(workflow.jobFunctions).length,
    updatedAt: workflow.updatedAt
      ? timestampDate(workflow.updatedAt).toISOString()
      : "N/A",
  };
}

export function toWorkflowInfo(workflow: Workflow): WorkflowInfo {
  const jobFunctions: Record<string, string> = {};
  for (const [name, version] of Object.entries(workflow.jobFunctions)) {
    jobFunctions[name] = version.toString();
  }

  return {
    name: workflow.name,
    id: workflow.id,
    mainJob: workflow.mainJobFunctionName,
    jobFunctions: JSON.stringify(jobFunctions),
    createdAt: workflow.createdAt
      ? timestampDate(workflow.createdAt).toISOString()
      : "N/A",
    updatedAt: workflow.updatedAt
      ? timestampDate(workflow.updatedAt).toISOString()
      : "N/A",
  };
}

export function toWorkflowJobExecutionInfo(
  jobExecution: WorkflowJobExecution,
): WorkflowJobExecutionInfo {
  return {
    id: jobExecution.id,
    stackedJobName: jobExecution.stackedJobName,
    status: workflowJobExecutionStatusToString(jobExecution.status),
    executionId: jobExecution.executionId,
    startedAt: jobExecution.startedAt
      ? timestampDate(jobExecution.startedAt).toISOString()
      : "N/A",
    finishedAt: jobExecution.finishedAt
      ? timestampDate(jobExecution.finishedAt).toISOString()
      : "N/A",
  };
}

export function toWorkflowExecutionInfo(
  execution: WorkflowExecution,
): WorkflowExecutionInfo {
  return {
    id: execution.id,
    workflowName: execution.workflowName,
    status: workflowExecutionStatusToString(execution.status),
    jobExecutions: execution.jobExecutions.length,
    startedAt: execution.startedAt
      ? timestampDate(execution.startedAt).toISOString()
      : "N/A",
    finishedAt: execution.finishedAt
      ? timestampDate(execution.finishedAt).toISOString()
      : "N/A",
  };
}
