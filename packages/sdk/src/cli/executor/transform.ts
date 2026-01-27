import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ExecutorJobStatus } from "@tailor-proto/tailor/v1/executor_resource_pb";
import type { ExecutorJob, ExecutorJobAttempt } from "@tailor-proto/tailor/v1/executor_resource_pb";

export interface ExecutorJobListInfo {
  id: string;
  executorName: string;
  status: string;
  createdAt: string;
}

export interface ExecutorJobInfo {
  id: string;
  executorName: string;
  status: string;
  scheduledAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutorJobAttemptInfo {
  id: string;
  jobId: string;
  status: string;
  error: string;
  startedAt: string;
  finishedAt: string;
  operationReference: string;
}

/**
 * Convert executor job status enum to string.
 * @param status - Executor job status enum
 * @returns Status string
 */
export function executorJobStatusToString(status: ExecutorJobStatus): string {
  switch (status) {
    case ExecutorJobStatus.PENDING:
      return "PENDING";
    case ExecutorJobStatus.RUNNING:
      return "RUNNING";
    case ExecutorJobStatus.SUCCESS:
      return "SUCCESS";
    case ExecutorJobStatus.FAILED:
      return "FAILED";
    case ExecutorJobStatus.CANCELED:
      return "CANCELED";
    default:
      return "UNSPECIFIED";
  }
}

/**
 * Transform ExecutorJob to ExecutorJobListInfo for list display.
 * @param job - Executor job from proto
 * @returns Executor job list info
 */
export function toExecutorJobListInfo(job: ExecutorJob): ExecutorJobListInfo {
  return {
    id: job.id,
    executorName: job.executorName,
    status: executorJobStatusToString(job.status),
    createdAt: job.createdAt ? timestampDate(job.createdAt).toISOString() : "N/A",
  };
}

/**
 * Transform ExecutorJob to ExecutorJobInfo for detail display.
 * @param job - Executor job from proto
 * @returns Executor job info
 */
export function toExecutorJobInfo(job: ExecutorJob): ExecutorJobInfo {
  return {
    id: job.id,
    executorName: job.executorName,
    status: executorJobStatusToString(job.status),
    scheduledAt: job.scheduledAt ? timestampDate(job.scheduledAt).toISOString() : "N/A",
    createdAt: job.createdAt ? timestampDate(job.createdAt).toISOString() : "N/A",
    updatedAt: job.updatedAt ? timestampDate(job.updatedAt).toISOString() : "N/A",
  };
}

/**
 * Transform ExecutorJobAttempt to ExecutorJobAttemptInfo for display.
 * @param attempt - Executor job attempt from proto
 * @returns Executor job attempt info
 */
export function toExecutorJobAttemptInfo(attempt: ExecutorJobAttempt): ExecutorJobAttemptInfo {
  return {
    id: attempt.id,
    jobId: attempt.jobId,
    status: executorJobStatusToString(attempt.status),
    error: attempt.error || "",
    startedAt: attempt.startedAt ? timestampDate(attempt.startedAt).toISOString() : "N/A",
    finishedAt: attempt.finishedAt ? timestampDate(attempt.finishedAt).toISOString() : "N/A",
    operationReference: attempt.operationReference || "",
  };
}
