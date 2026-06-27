import { setTimeout } from "timers/promises";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  ExecutorJobStatus,
  ExecutorTargetType,
} from "@tailor-platform/tailor-proto/executor_resource_pb";
import { FunctionExecution_Status } from "@tailor-platform/tailor-proto/function_resource_pb";
import {
  Condition_Operator,
  ConditionSchema,
  FilterSchema,
  PageDirection,
} from "@tailor-platform/tailor-proto/resource_pb";
import { arg } from "politty";
import { z } from "zod";
import {
  durationArg,
  nonNegativeIntArg,
  type Order,
  pagedLogArgs,
  parseDuration,
  toPageDirection,
  workspaceArgs,
} from "#/cli/shared/args";
import { fetchAll, fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { formatKeyValueTable } from "#/cli/shared/format";
import { functionExecutionStatusToString } from "#/cli/shared/function-execution";
import { logger, styles } from "#/cli/shared/logger";
import { spinner } from "#/cli/shared/spinner";
import { formatWaitError, isRetryableWaitError } from "#/cli/shared/wait-error";
import { getWorkflowExecution } from "../workflow/executions";
import { waitForExecution } from "../workflow/start";
import {
  classifyExecutorJobStatus,
  colorizeExecutorJobStatus,
  colorizeFunctionExecutionStatus,
  executorTargetTypeToString,
  isFunctionExecutionTerminalStatus,
  parseExecutorJobStatus,
} from "./status";
import {
  type ExecutorJobListInfo,
  type ExecutorJobInfo,
  type ExecutorJobAttemptInfo,
  toExecutorJobListInfo,
  toExecutorJobInfo,
  toExecutorJobAttemptInfo,
} from "./transform";

type ExecutorLike = {
  name: string;
};

export type ListExecutorJobsTypedOptions<E extends ExecutorLike = ExecutorLike> = {
  executor: E;
  status?: string;
  order?: Order;
  limit?: number;
  workspaceId?: string;
  profile?: string;
};

export type GetExecutorJobTypedOptions<E extends ExecutorLike = ExecutorLike> = {
  executor: E;
  jobId: string;
  attempts?: boolean;
  workspaceId?: string;
  profile?: string;
};

export type WatchExecutorJobTypedOptions<E extends ExecutorLike = ExecutorLike> = {
  executor: E;
  jobId: string;
  workspaceId?: string;
  profile?: string;
  interval?: number;
  timeout?: number;
  logs?: boolean;
  showProgress?: boolean;
};

/**
 * @deprecated Use ListExecutorJobsTypedOptions instead.
 */
export interface ListExecutorJobsOptions {
  executorName: string;
  status?: string;
  order?: Order;
  limit?: number;
  workspaceId?: string;
  profile?: string;
}

/**
 * @deprecated Use GetExecutorJobTypedOptions instead.
 */
export interface GetExecutorJobOptions {
  executorName: string;
  jobId: string;
  attempts?: boolean;
  workspaceId?: string;
  profile?: string;
}

/**
 * @deprecated Use WatchExecutorJobTypedOptions instead.
 */
export interface WatchExecutorJobOptions {
  executorName: string;
  jobId: string;
  workspaceId?: string;
  profile?: string;
  interval?: number;
  timeout?: number;
  logs?: boolean;
  showProgress?: boolean;
}

export interface ExecutorJobDetailInfo extends ExecutorJobInfo {
  attempts?: ExecutorJobAttemptInfo[];
}

export interface WorkflowJobLog {
  jobName: string;
  logs?: string;
  result?: string;
}

export interface WatchExecutorJobResult {
  job: ExecutorJobDetailInfo;
  targetType: string;
  elapsedMs: number;
  attempts: number;
  timedOut: boolean;
  lastError: string | null;
  workflowExecutionId?: string;
  workflowStatus?: string;
  workflowJobLogs?: WorkflowJobLog[];
  functionExecutionId?: string;
  functionStatus?: string;
  functionLogs?: string;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function createUnknownExecutorJob(executorName: string, jobId: string): ExecutorJobDetailInfo {
  return {
    id: jobId,
    executorName,
    status: "UNKNOWN",
    scheduledAt: "N/A",
    createdAt: "N/A",
    updatedAt: "N/A",
  };
}

/**
 * List executor jobs for a given executor.
 *
 * Returns at most `options.limit` items. When `limit` is omitted or 0 the
 * function pages through every job. The CLI caps this at 50 by default
 * via `pagedLogArgs`; programmatic callers that want the same cap should
 * pass `limit: 50` explicitly.
 * @param options - Options for listing executor jobs
 * @returns List of executor job information
 */
export async function listExecutorJobs<E extends ExecutorLike>(
  options: ListExecutorJobsTypedOptions<E>,
): Promise<ExecutorJobListInfo[]>;
export async function listExecutorJobs(
  options: ListExecutorJobsOptions,
): Promise<ExecutorJobListInfo[]>;
export async function listExecutorJobs<E extends ExecutorLike>(
  options: ListExecutorJobsOptions | ListExecutorJobsTypedOptions<E>,
): Promise<ExecutorJobListInfo[]> {
  // Discriminant: legacy options have top-level 'executorName', typed options use 'executor'.
  const executorName = "executorName" in options ? options.executorName : options.executor.name;
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const filters: ReturnType<typeof create<typeof FilterSchema>>[] = [];

  if (options.status) {
    const statusValue = parseExecutorJobStatus(options.status);
    filters.push(
      create(FilterSchema, {
        condition: create(ConditionSchema, {
          field: "status",
          operator: Condition_Operator.EQ,
          value: { kind: { case: "numberValue", value: statusValue } },
        }),
      }),
    );
  }

  const filter = filters.length > 0 ? create(FilterSchema, { and: filters }) : undefined;

  const pageDirection = toPageDirection(options.order ?? "desc");

  try {
    const jobs = await fetchPaged(
      async (pageToken, pageSize) => {
        const { jobs, nextPageToken } = await client.listExecutorJobs({
          workspaceId,
          executorName,
          pageToken,
          pageSize,
          pageDirection,
          filter,
        });
        return [jobs, nextPageToken];
      },
      { limit: options.limit },
    );

    return jobs.map(toExecutorJobListInfo);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Executor '${executorName}' not found.`, { cause: error });
    }
    throw error;
  }
}

/**
 * Get details of a specific executor job.
 * @param options - Options for getting executor job details
 * @returns Executor job detail information
 */
export async function getExecutorJob<E extends ExecutorLike>(
  options: GetExecutorJobTypedOptions<E>,
): Promise<ExecutorJobDetailInfo>;
export async function getExecutorJob(
  options: GetExecutorJobOptions,
): Promise<ExecutorJobDetailInfo>;
export async function getExecutorJob<E extends ExecutorLike>(
  options: GetExecutorJobOptions | GetExecutorJobTypedOptions<E>,
): Promise<ExecutorJobDetailInfo> {
  // Discriminant: legacy options have top-level 'executorName', typed options use 'executor'.
  const executorName = "executorName" in options ? options.executorName : options.executor.name;
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  try {
    const { job } = await client.getExecutorJob({
      workspaceId,
      executorName,
      jobId: options.jobId,
    });

    if (!job) {
      throw new Error(`Job '${options.jobId}' not found.`);
    }

    const jobInfo = toExecutorJobInfo(job);

    if (options.attempts) {
      const attempts = await fetchAll(async (pageToken, maxPageSize) => {
        const { attempts, nextPageToken } = await client.listExecutorJobAttempts({
          workspaceId,
          jobId: options.jobId,
          pageToken,
          pageSize: maxPageSize,
          pageDirection: PageDirection.DESC,
        });
        return [attempts, nextPageToken];
      });

      return {
        ...jobInfo,
        attempts: attempts.map(toExecutorJobAttemptInfo),
      };
    }

    return jobInfo;
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Job '${options.jobId}' not found for executor '${executorName}'.`, {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Watch an executor job until completion, including downstream executions.
 * @param options - Options for watching executor job
 * @returns Result including job details and downstream execution info
 */
export async function watchExecutorJob<E extends ExecutorLike>(
  options: WatchExecutorJobTypedOptions<E>,
): Promise<WatchExecutorJobResult>;
export async function watchExecutorJob(
  options: WatchExecutorJobOptions,
): Promise<WatchExecutorJobResult>;
export async function watchExecutorJob<E extends ExecutorLike>(
  options: WatchExecutorJobOptions | WatchExecutorJobTypedOptions<E>,
): Promise<WatchExecutorJobResult> {
  // Discriminant: legacy options have top-level 'executorName', typed options use 'executor'.
  const executorName = "executorName" in options ? options.executorName : options.executor.name;
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const interval = options.interval ?? 3000;
  const timeout = options.timeout;
  const showProgress = options.showProgress ?? !logger.jsonMode;
  const startedAt = Date.now();
  const sp = showProgress ? spinner().start("Waiting for executor job to complete...") : null;

  let attempts = 0;
  let lastError: string | null = null;

  type WatchExecutorJobResultBase = Omit<
    WatchExecutorJobResult,
    "elapsedMs" | "attempts" | "timedOut" | "lastError"
  >;

  const remainingTimeout = (): number | undefined => {
    if (timeout === undefined) {
      return undefined;
    }
    return timeout - (Date.now() - startedAt);
  };

  const withWaitMetadata = (
    result: WatchExecutorJobResultBase,
    timedOut: boolean,
  ): WatchExecutorJobResult => ({
    ...result,
    elapsedMs: Date.now() - startedAt,
    attempts,
    timedOut,
    lastError,
  });

  const timeoutResult = (
    targetType: string,
    job: Awaited<ReturnType<typeof client.getExecutorJob>>["job"],
  ): WatchExecutorJobResult =>
    withWaitMetadata(
      {
        job: job ? toExecutorJobInfo(job) : createUnknownExecutorJob(executorName, options.jobId),
        targetType,
      },
      true,
    );

  try {
    // Get executor details to determine target type
    const { executor } = await client.getExecutorExecutor({
      workspaceId,
      name: executorName,
    });

    if (!executor) {
      throw new Error(`Executor '${executorName}' not found.`);
    }

    const targetType = executor.targetType;
    const targetTypeStr = executorTargetTypeToString(targetType);

    // Phase 1: Wait for executor job to complete
    let job: Awaited<ReturnType<typeof client.getExecutorJob>>["job"];
    // loop exits when the executor job reaches a terminal status
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const remainingMs = remainingTimeout();
      if (remainingMs !== undefined && remainingMs <= 0) {
        sp?.fail("Executor job wait timed out.");
        return timeoutResult(targetTypeStr, job);
      }

      try {
        attempts += 1;
        const response = await client.getExecutorJob({
          workspaceId,
          executorName,
          jobId: options.jobId,
        });

        job = response.job;
        if (!job) {
          throw new Error(`Job '${options.jobId}' not found.`);
        }
        lastError = null;

        if (classifyExecutorJobStatus(job.status) !== "transient") {
          break;
        }
      } catch (error) {
        if (!isRetryableWaitError(error)) {
          throw error;
        }
        lastError = formatWaitError(error);
        if (sp) {
          sp.text = `Retrying executor job poll... (${formatTime(new Date())})`;
        }
      }

      const nextRemainingMs = remainingTimeout();
      if (nextRemainingMs !== undefined && nextRemainingMs <= 0) {
        sp?.fail("Executor job wait timed out.");
        return timeoutResult(targetTypeStr, job);
      }

      if (sp) {
        sp.text = `Waiting for executor job... (${formatTime(new Date())})`;
      }
      await setTimeout(
        nextRemainingMs === undefined ? interval : Math.min(interval, nextRemainingMs),
      );
    }

    const jobInfo = toExecutorJobInfo(job);
    const coloredStatus = colorizeExecutorJobStatus(jobInfo.status);

    if (job.status === ExecutorJobStatus.SUCCESS) {
      sp?.succeed(`Executor job completed: ${coloredStatus}`);
    } else {
      sp?.fail(`Executor job completed: ${coloredStatus}`);
    }

    // Get attempts to find operationReference
    const attemptRecords = await fetchAll(async (pageToken, maxPageSize) => {
      const { attempts: jobAttempts, nextPageToken } = await client.listExecutorJobAttempts({
        workspaceId,
        jobId: options.jobId,
        pageToken,
        pageSize: maxPageSize,
        pageDirection: PageDirection.DESC,
      });
      return [jobAttempts, nextPageToken];
    });

    const attemptInfos = attemptRecords.map(toExecutorJobAttemptInfo);
    const jobDetail: ExecutorJobDetailInfo = {
      ...jobInfo,
      attempts: attemptInfos,
    };

    const latestAttempt = attemptInfos[0];
    const operationReference = latestAttempt?.operationReference;

    // Phase 2: Based on target type, wait for the downstream execution
    if (operationReference) {
      switch (targetType) {
        case ExecutorTargetType.WORKFLOW: {
          // Wait for workflow execution with progress display
          sp?.stop();

          try {
            const workflowTimeout = remainingTimeout();
            if (workflowTimeout !== undefined && workflowTimeout <= 0) {
              return withWaitMetadata(
                {
                  job: jobDetail,
                  targetType: targetTypeStr,
                  workflowExecutionId: operationReference,
                },
                true,
              );
            }

            // Use waitForExecution with progress display (same as workflow start)
            const executionResult = await waitForExecution({
              client,
              workspaceId,
              executionId: operationReference,
              interval,
              timeout: workflowTimeout,
              showProgress,
              trackJobs: true,
            });
            attempts += executionResult.attempts;
            lastError = executionResult.lastError;

            // Fetch logs if requested
            let workflowJobLogs: WorkflowJobLog[] | undefined;
            if (options.logs) {
              try {
                const { execution: execWithLogs } = await getWorkflowExecution({
                  executionId: operationReference,
                  workspaceId: options.workspaceId,
                  profile: options.profile,
                  logs: true,
                });
                if (execWithLogs.jobDetails) {
                  workflowJobLogs = execWithLogs.jobDetails
                    .filter((job) => job.logs || job.result)
                    .map((job) => ({
                      jobName: job.stackedJobName || job.id,
                      logs: job.logs,
                      result: job.result,
                    }));
                }
              } catch (error) {
                logger.warn(
                  `Could not fetch workflow execution logs: ${error instanceof Error ? error.message : error}`,
                );
              }
            }

            return withWaitMetadata(
              {
                job: jobDetail,
                targetType: targetTypeStr,
                workflowExecutionId: operationReference,
                workflowStatus: executionResult.status,
                workflowJobLogs,
              },
              executionResult.timedOut,
            );
          } catch (error) {
            logger.warn(
              `Could not track workflow execution: ${error instanceof Error ? error.message : error}`,
            );
            return withWaitMetadata(
              {
                job: jobDetail,
                targetType: targetTypeStr,
                workflowExecutionId: operationReference,
              },
              false,
            );
          }
        }

        case ExecutorTargetType.FUNCTION:
        case ExecutorTargetType.JOB_FUNCTION:
          {
            // Wait for function execution
            sp?.start(`Waiting for function execution ${operationReference}...`);

            try {
              let functionStatus: string | undefined;
              // oxlint-disable-next-line typescript/no-unnecessary-condition
              while (true) {
                const functionTimeout = remainingTimeout();
                if (functionTimeout !== undefined && functionTimeout <= 0) {
                  sp?.fail("Function execution wait timed out.");
                  return withWaitMetadata(
                    {
                      job: jobDetail,
                      targetType: targetTypeStr,
                      functionExecutionId: operationReference,
                      functionStatus,
                    },
                    true,
                  );
                }

                try {
                  attempts += 1;
                  const { execution } = await client.getFunctionExecution({
                    workspaceId,
                    executionId: operationReference,
                  });

                  if (!execution) {
                    throw new Error(`Function execution '${operationReference}' not found.`);
                  }

                  lastError = null;
                  functionStatus = functionExecutionStatusToString(execution.status);

                  if (isFunctionExecutionTerminalStatus(execution.status)) {
                    const coloredFnStatus = colorizeFunctionExecutionStatus(functionStatus);
                    if (execution.status === FunctionExecution_Status.SUCCESS) {
                      sp?.succeed(`Function execution completed: ${coloredFnStatus}`);
                    } else {
                      sp?.fail(`Function execution completed: ${coloredFnStatus}`);
                    }
                    return withWaitMetadata(
                      {
                        job: jobDetail,
                        targetType: targetTypeStr,
                        functionExecutionId: operationReference,
                        functionStatus,
                        functionLogs: options.logs ? execution.logs || undefined : undefined,
                      },
                      false,
                    );
                  }
                } catch (error) {
                  if (!isRetryableWaitError(error)) {
                    throw error;
                  }
                  lastError = formatWaitError(error);
                  if (sp) {
                    sp.text = `Retrying function execution poll... (${formatTime(new Date())})`;
                  }
                }

                const nextFunctionTimeout = remainingTimeout();
                if (nextFunctionTimeout !== undefined && nextFunctionTimeout <= 0) {
                  sp?.fail("Function execution wait timed out.");
                  return withWaitMetadata(
                    {
                      job: jobDetail,
                      targetType: targetTypeStr,
                      functionExecutionId: operationReference,
                      functionStatus,
                    },
                    true,
                  );
                }

                if (sp) {
                  sp.text = `Waiting for function execution... (${formatTime(new Date())})`;
                }
                await setTimeout(
                  nextFunctionTimeout === undefined
                    ? interval
                    : Math.min(interval, nextFunctionTimeout),
                );
              }
            } catch (error) {
              sp?.warn(
                `Could not track function execution: ${error instanceof Error ? error.message : error}`,
              );
              return withWaitMetadata(
                {
                  job: jobDetail,
                  targetType: targetTypeStr,
                  functionExecutionId: operationReference,
                },
                false,
              );
            }
          }
          break;
        default:
          // WEBHOOK, TAILOR_GRAPHQL, or unknown - no downstream execution to track
          break;
      }
    }

    return withWaitMetadata({ job: jobDetail, targetType: targetTypeStr }, false);
  } finally {
    sp?.stop();
  }
}

/**
 * Build a user-facing failure message for an executor job wait result.
 * @param result - Executor job wait result
 * @returns Failure message, or undefined when the wait succeeded
 */
export function getExecutorWaitFailureMessage(result: WatchExecutorJobResult): string | undefined {
  if (result.timedOut) {
    return `Timed out waiting for executor job '${result.job.id}'. Last status: ${result.job.status}.`;
  }
  if (result.job.status === "FAILED" || result.job.status === "CANCELED") {
    return `Executor job '${result.job.id}' completed with status ${result.job.status}.`;
  }
  if (result.workflowStatus === "FAILED") {
    return `Workflow execution '${result.workflowExecutionId}' failed.`;
  }
  if (result.functionStatus === "FAILED") {
    return `Function execution '${result.functionExecutionId}' failed.`;
  }
  return undefined;
}

function printJobWithAttempts(job: ExecutorJobDetailInfo): void {
  // Print job summary
  const summaryData: [string, string][] = [
    ["id", job.id],
    ["executorName", job.executorName],
    ["status", job.status],
    ["scheduledAt", job.scheduledAt],
    ["createdAt", job.createdAt],
    ["updatedAt", job.updatedAt],
  ];
  logger.log(formatKeyValueTable(summaryData));

  // Print attempts
  if (job.attempts && job.attempts.length > 0) {
    logger.log(styles.bold("\nAttempts:"));
    for (const attempt of job.attempts) {
      logger.log(styles.info(`\n--- Attempt ${attempt.id} ---`));
      logger.log(`  Status: ${attempt.status}`);
      logger.log(`  Started: ${attempt.startedAt}`);
      logger.log(`  Finished: ${attempt.finishedAt}`);

      if (attempt.error) {
        logger.log(styles.error("\n  Error:"));
        const errorLines = attempt.error.split("\n");
        for (const line of errorLines) {
          logger.log(`    ${line}`);
        }
      }
    }
  }
}

export const jobsCommand = defineAppCommand({
  name: "jobs",
  description: "List or get executor jobs.",
  examples: [
    {
      cmd: "my-executor",
      desc: "List jobs for an executor (default: 50 jobs)",
    },
    { cmd: "my-executor --limit 10", desc: "Limit the number of jobs" },
    { cmd: "my-executor -s RUNNING", desc: "Filter by status" },
    { cmd: "my-executor <job-id>", desc: "Get job details" },
    {
      cmd: "my-executor <job-id> --attempts",
      desc: "Get job details with attempts",
    },
    { cmd: "my-executor <job-id> -W", desc: "Wait for job to complete" },
    {
      cmd: "my-executor <job-id> -W -l",
      desc: "Wait for job with logs",
    },
  ],
  args: z.strictObject({
    ...workspaceArgs,
    "executor-name": arg(z.string(), {
      positional: true,
      description: "Executor name",
    }),
    "job-id": arg(z.string().optional(), {
      positional: true,
      description: "Job ID (if provided, shows job details)",
    }),
    status: arg(z.string().optional(), {
      alias: "s",
      description:
        "Filter by status (PENDING, RUNNING, SUCCESS, FAILED, CANCELED) (list mode only)",
    }),
    attempts: arg(z.boolean().default(false), {
      description: "Show job attempts (only with job ID) (detail mode only)",
    }),
    wait: arg(z.boolean().default(false), {
      alias: "W",
      description:
        "Wait for job completion and downstream execution (workflow/function) if applicable (detail mode only)",
    }),
    interval: arg(durationArg.default("3s"), {
      alias: "i",
      description: "Polling interval when using --wait (e.g., '3s', '500ms', '1m')",
    }),
    timeout: arg(durationArg.default("5m"), {
      alias: "t",
      description: "Maximum time to wait when using --wait (e.g., '30s', '5m')",
    }),
    ...pagedLogArgs,
    limit: arg(nonNegativeIntArg.default(50), {
      description: "Maximum number of jobs to list (0: unlimited, default: 50) (list mode only)",
    }),
    logs: arg(z.boolean().default(false), {
      alias: "l",
      description: "Display function execution logs after completion (requires --wait)",
    }),
  }),
  run: async (args) => {
    const jsonOutput = logger.jsonMode || args.json;
    if (args.jobId) {
      if (args.wait) {
        const result = await watchExecutorJob({
          executorName: args.executorName,
          jobId: args.jobId,
          workspaceId: args["workspace-id"],
          profile: args.profile,
          interval: parseDuration(args.interval),
          timeout: parseDuration(args.timeout),
          logs: args.logs,
          showProgress: !jsonOutput,
        });

        // Print result
        if (!jsonOutput) {
          logger.log(styles.bold(`Target Type: ${result.targetType}\n`));
          printJobWithAttempts(result.job);
          if (result.workflowExecutionId) {
            logger.log(styles.bold("\nWorkflow Execution:"));
            logger.log(`  ID: ${result.workflowExecutionId}`);
            if (result.workflowStatus) {
              logger.log(`  Status: ${result.workflowStatus}`);
            }
            if (result.workflowJobLogs && result.workflowJobLogs.length > 0) {
              for (const jobLog of result.workflowJobLogs) {
                logger.log(styles.bold(`\n  Job: ${jobLog.jobName}`));
                if (jobLog.logs) {
                  logger.log(styles.dim("    Logs:"));
                  for (const line of jobLog.logs.split("\n")) {
                    logger.log(`      ${line}`);
                  }
                }
                if (jobLog.result) {
                  logger.log(styles.dim("    Result:"));
                  try {
                    const parsed = JSON.parse(jobLog.result);
                    const formatted = JSON.stringify(parsed, null, 2);
                    for (const line of formatted.split("\n")) {
                      logger.log(`      ${line}`);
                    }
                  } catch {
                    logger.log(`      ${jobLog.result}`);
                  }
                }
              }
            }
          }
          if (result.functionExecutionId) {
            logger.log(styles.bold("\nFunction Execution:"));
            logger.log(`  ID: ${result.functionExecutionId}`);
            if (result.functionStatus) {
              logger.log(`  Status: ${result.functionStatus}`);
            }
            if (result.functionLogs) {
              logger.log(styles.dim("  Logs:"));
              for (const line of result.functionLogs.split("\n")) {
                logger.log(`    ${line}`);
              }
            }
          }
        } else {
          logger.out(result);
        }
        const failureMessage = getExecutorWaitFailureMessage(result);
        if (failureMessage) {
          throw new Error(failureMessage);
        }
        return;
      }

      const job = await getExecutorJob({
        executorName: args.executorName,
        jobId: args.jobId,
        attempts: args.attempts,
        workspaceId: args["workspace-id"],
        profile: args.profile,
      });
      if (args.attempts && !jsonOutput) {
        printJobWithAttempts(job);
      } else {
        logger.out(job);
      }
    } else {
      if (args.wait) {
        logger.warn("--wait flag is ignored in list mode. Specify a job ID to wait.");
      }
      const jobs = await listExecutorJobs({
        executorName: args.executorName,
        status: args.status,
        order: args.order,
        limit: args.limit,
        workspaceId: args["workspace-id"],
        profile: args.profile,
      });
      logger.out(jobs);
    }
  },
});
