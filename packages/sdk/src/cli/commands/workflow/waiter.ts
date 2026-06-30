import { setTimeout } from "node:timers/promises";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger, styles } from "#/cli/shared/logger";
import { spinner } from "#/cli/shared/spinner";
import { formatWaitError, isRetryableWaitError } from "#/cli/shared/wait-error";
import {
  classifyWorkflowExecutionStatus,
  hasReachedWorkflowWaitTarget,
  isWorkflowExecutionFailureStatus,
  isWorkflowExecutionSuspendedStatus,
  type WorkflowExecutionStatusClass,
  type WorkflowWaitUntil,
} from "./status";
import { type WorkflowExecutionInfo, toWorkflowExecutionInfo } from "./transform";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

export const DEFAULT_WORKFLOW_WAIT_INTERVAL_MS = 3000;

export interface WorkflowWaitOptions {
  client: Awaited<ReturnType<typeof initOperatorClient>>;
  workspaceId: string;
  executionId: string;
  interval?: number;
  timeout?: number;
  until?: WorkflowWaitUntil;
  showProgress?: boolean;
  trackJobs?: boolean;
}

export interface WaitWorkflowExecutionOptions {
  executionId: string;
  workspaceId?: string;
  profile?: string;
  interval?: number;
  timeout?: number;
  until?: WorkflowWaitUntil;
  showProgress?: boolean;
  trackJobs?: boolean;
}

export interface WorkflowWaitResult extends WorkflowExecutionInfo {
  statusClass: WorkflowExecutionStatusClass | "unknown";
  elapsedMs: number;
  attempts: number;
  timedOut: boolean;
  lastError: string | null;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function colorizeStatus(status: WorkflowExecution_Status): string {
  const statusText = WorkflowExecution_Status[status];
  switch (status) {
    case WorkflowExecution_Status.PENDING:
    case WorkflowExecution_Status.UNSPECIFIED:
      return styles.dim(statusText);
    case WorkflowExecution_Status.PENDING_RESUME:
    case WorkflowExecution_Status.PENDING_RETRY:
    case WorkflowExecution_Status.WAITING:
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

function getActiveJobs(execution: WorkflowExecution): string {
  return execution.jobExecutions
    .filter(
      (job) =>
        job.status === WorkflowJobExecution_Status.RUNNING ||
        job.status === WorkflowJobExecution_Status.SUSPEND ||
        job.status === WorkflowJobExecution_Status.WAITING,
    )
    .map((job) => job.stackedJobName)
    .join(", ");
}

interface CreateWorkflowWaitResultOptions {
  executionId: string;
  execution: WorkflowExecution | undefined;
  startedAt: number;
  attempts: number;
  timedOut: boolean;
  lastError: string | null;
}

function createWorkflowWaitResult(options: CreateWorkflowWaitResultOptions): WorkflowWaitResult {
  const elapsedMs = Date.now() - options.startedAt;
  if (options.execution) {
    const classification = classifyWorkflowExecutionStatus(options.execution);
    return {
      ...toWorkflowExecutionInfo(options.execution),
      statusClass: classification.statusClass,
      elapsedMs,
      attempts: options.attempts,
      timedOut: options.timedOut,
      lastError: options.lastError,
    };
  }
  return {
    id: options.executionId,
    workflowName: "",
    status: "UNKNOWN",
    statusClass: "unknown",
    jobExecutions: 0,
    startedAt: null,
    finishedAt: null,
    elapsedMs,
    attempts: options.attempts,
    timedOut: options.timedOut,
    lastError: options.lastError,
  };
}

/**
 * Wait for a workflow execution to reach the requested state.
 * @param options - Workflow waiter options
 * @returns Final or timed-out workflow wait result
 */
export async function waitForWorkflowExecution(
  options: WorkflowWaitOptions,
): Promise<WorkflowWaitResult> {
  const interval = options.interval ?? DEFAULT_WORKFLOW_WAIT_INTERVAL_MS;
  const until = options.until ?? "terminal";
  const startedAt = Date.now();
  const sp = options.showProgress
    ? spinner({ indent: 2 }).start("Waiting for workflow to complete...")
    : null;

  let attempts = 0;
  let lastExecution: WorkflowExecution | undefined;
  let lastError: string | null = null;
  let lastStatus: WorkflowExecution_Status | undefined;
  let lastActiveJobs: string | undefined;

  try {
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = options.timeout === undefined ? undefined : options.timeout - elapsedMs;
      if (remainingMs !== undefined && remainingMs <= 0) {
        sp?.fail("Workflow wait timed out.");
        return createWorkflowWaitResult({
          executionId: options.executionId,
          execution: lastExecution,
          startedAt,
          attempts,
          timedOut: true,
          lastError,
        });
      }

      try {
        attempts += 1;
        const { execution } = await options.client.getWorkflowExecution({
          workspaceId: options.workspaceId,
          executionId: options.executionId,
        });

        if (!execution) {
          sp?.fail(`Execution '${options.executionId}' not found.`);
          throw new Error(`Execution '${options.executionId}' not found.`);
        }

        lastExecution = execution;
        lastError = null;

        const classification = classifyWorkflowExecutionStatus(execution);
        const coloredStatus = colorizeStatus(execution.status);

        if (execution.status !== lastStatus) {
          if (options.showProgress) {
            sp?.stop();
            logger.info(`Status: ${coloredStatus}`, {
              mode: "stream",
              indent: 2,
            });
            sp?.start("Waiting for workflow to complete...");
          }
          lastStatus = execution.status;
        }

        if (options.trackJobs) {
          const activeJobs = getActiveJobs(execution);
          if (activeJobs && activeJobs !== lastActiveJobs) {
            if (options.showProgress) {
              sp?.stop();
              logger.info(`Job | ${activeJobs}: ${coloredStatus}`, {
                mode: "stream",
                indent: 2,
              });
              sp?.start("Waiting for workflow to complete...");
            }
            lastActiveJobs = activeJobs;
          }
        }

        if (sp) {
          sp.text = `Waiting for workflow to complete... (${formatTime(new Date())})`;
        }

        if (
          hasReachedWorkflowWaitTarget(classification, until) ||
          classification.statusClass === "failure" ||
          (until === "suspended" && classification.statusClass === "success")
        ) {
          if (execution.status === WorkflowExecution_Status.SUCCESS) {
            sp?.succeed(`Completed: ${coloredStatus}`);
          } else if (isWorkflowExecutionFailureStatus(execution.status)) {
            sp?.fail(`Completed: ${coloredStatus}`);
          } else if (isWorkflowExecutionSuspendedStatus(execution.status)) {
            sp?.warn(`Completed: ${coloredStatus}`);
          } else {
            sp?.succeed(`Completed: ${coloredStatus}`);
          }
          return createWorkflowWaitResult({
            executionId: options.executionId,
            execution,
            startedAt,
            attempts,
            timedOut: false,
            lastError,
          });
        }
      } catch (error) {
        if (!isRetryableWaitError(error)) {
          throw error;
        }
        lastError = formatWaitError(error);
        if (options.showProgress) {
          if (sp) {
            sp.text = `Retrying workflow status poll... (${formatTime(new Date())})`;
          }
        }
      }

      const nextElapsedMs = Date.now() - startedAt;
      const nextRemainingMs =
        options.timeout === undefined ? undefined : options.timeout - nextElapsedMs;
      if (nextRemainingMs !== undefined && nextRemainingMs <= 0) {
        sp?.fail("Workflow wait timed out.");
        return createWorkflowWaitResult({
          executionId: options.executionId,
          execution: lastExecution,
          startedAt,
          attempts,
          timedOut: true,
          lastError,
        });
      }

      await setTimeout(
        nextRemainingMs === undefined ? interval : Math.min(interval, nextRemainingMs),
      );
    }
  } finally {
    sp?.stop();
  }
}

/**
 * Wait for an existing workflow execution by ID.
 * @param options - Workflow execution wait options
 * @returns Workflow wait result
 */
export async function waitForWorkflowExecutionById(
  options: WaitWorkflowExecutionOptions,
): Promise<WorkflowWaitResult> {
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  return await waitForWorkflowExecution({
    client,
    workspaceId,
    executionId: options.executionId,
    interval: options.interval,
    timeout: options.timeout,
    until: options.until,
    showProgress: options.showProgress,
    trackJobs: options.trackJobs,
  });
}

/**
 * Build a user-facing failure message for a workflow wait result.
 * @param result - Workflow wait result
 * @param until - Requested wait target
 * @returns Failure message, or undefined when the wait succeeded
 */
export function getWorkflowWaitFailureMessage(
  result: WorkflowWaitResult,
  until: WorkflowWaitUntil,
): string | undefined {
  if (result.timedOut) {
    return `Timed out waiting for workflow execution '${result.id}' to reach ${until}. Last status: ${result.status}.`;
  }
  if (result.status === "FAILED") {
    return `Workflow execution '${result.id}' failed.`;
  }
  if (until === "success" && result.statusClass !== "success") {
    return `Workflow execution '${result.id}' reached ${result.status} before success.`;
  }
  if (until === "suspended" && result.statusClass !== "suspended") {
    return `Workflow execution '${result.id}' reached ${result.status} before suspension.`;
  }
  return undefined;
}
