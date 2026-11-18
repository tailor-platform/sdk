import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { protoEnumName } from "#/cli/shared/proto-enum";
import type {
  Workflow,
  WorkflowExecution,
  WorkflowJobExecution,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";

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

/**
 * What a workflow job execution ran, either a job function or a wait for a key to be resolved.
 * `unknown` stands for a kind this SDK version does not know.
 */
export type WorkflowJobExecutionKindInfo =
  | { type: "jobFunction"; name: string }
  | { type: "wait"; key: string }
  | { type: "unknown" };

/** Where a workflow job execution sits among the jobs of its workflow execution. */
export interface WorkflowJobExecutionPositionInfo {
  /** `id` of the job execution that started this one. `null` on the main job. */
  parentJobExecutionId: string | null;
  /** Zero-based order of the call within the parent job. `null` on the main job. */
  callIndex: number | null;
  /** Zero-based branch within a group of jobs started in parallel. `null` outside such a group. */
  branchIndex: number | null;
  /** Distance from the main job, which is 0. */
  depth: number;
}

export interface WorkflowJobExecutionInfo {
  id: string;
  /**
   * @deprecated since 2.43.0 — the Platform is retiring this value, so this is never set; use `kind` for the job function name or wait key and `position` for the place among the other jobs instead. codemod: none (no automatic migration exists)
   */
  stackedJobName?: string;
  kind: WorkflowJobExecutionKindInfo;
  /** `null` when the Platform reported no position for the job. */
  position: WorkflowJobExecutionPositionInfo | null;
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
  return protoEnumName(WorkflowExecution_Status, status) ?? "UNSPECIFIED";
}

/**
 * Convert a workflow job execution status enum to a string.
 * @param status - Workflow job execution status
 * @returns String representation of the status
 */
function workflowJobExecutionStatusToString(status: WorkflowJobExecution_Status): string {
  return protoEnumName(WorkflowJobExecution_Status, status) ?? "UNSPECIFIED";
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

function toWorkflowJobExecutionKindInfo(
  kind: WorkflowJobExecution["kind"],
): WorkflowJobExecutionKindInfo {
  switch (kind.case) {
    case "jobFunction":
      return { type: "jobFunction", name: kind.value.name };
    case "wait":
      return { type: "wait", key: kind.value.key };
    default:
      return { type: "unknown" };
  }
}

function toWorkflowJobExecutionPositionInfo(
  position: WorkflowJobExecution["position"],
): WorkflowJobExecutionPositionInfo | null {
  if (!position) return null;
  return {
    parentJobExecutionId: position.parentWorkflowJobExecutionId || null,
    callIndex: position.callIndex ?? null,
    branchIndex: position.branchIndex ?? null,
    depth: position.depth,
  };
}

/**
 * Name a workflow job execution for display.
 * @param job - Workflow job execution info
 * @returns The job function name, `wait(<key>)` for a wait, or the id when the kind is unknown
 */
export function workflowJobExecutionLabel(
  job: Pick<WorkflowJobExecutionInfo, "id" | "kind">,
): string {
  switch (job.kind.type) {
    case "jobFunction":
      return job.kind.name;
    case "wait":
      return `wait(${job.kind.key})`;
    default:
      return job.id;
  }
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
    kind: toWorkflowJobExecutionKindInfo(jobExecution.kind),
    position: toWorkflowJobExecutionPositionInfo(jobExecution.position),
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
