import { setTimeout } from "timers/promises";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  ExecutorJobStatus,
  ExecutorTargetType,
} from "@tailor-proto/tailor/v1/executor_resource_pb";
import { FunctionExecution_Status } from "@tailor-proto/tailor/v1/function_resource_pb";
import {
  Condition_Operator,
  ConditionSchema,
  FilterSchema,
  PageDirection,
} from "@tailor-proto/tailor/v1/resource_pb";
import { defineCommand } from "citty";
import ora from "ora";
import { commonArgs, jsonArgs, parseDuration, withCommonArgs, workspaceArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { formatKeyValueTable } from "../utils/format";
import { logger, styles } from "../utils/logger";
import { getWorkflowExecution } from "../workflow/executions";
import { waitForExecution } from "../workflow/start";
import {
  colorizeExecutorJobStatus,
  colorizeFunctionExecutionStatus,
  executorTargetTypeToString,
  functionExecutionStatusToString,
  isFunctionExecutionTerminalStatus,
  isExecutorJobTerminalStatus,
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

export interface ListExecutorJobsOptions {
  executorName: string;
  status?: string;
  limit?: number;
  workspaceId?: string;
  profile?: string;
}

export interface GetExecutorJobOptions {
  executorName: string;
  jobId: string;
  attempts?: boolean;
  workspaceId?: string;
  profile?: string;
}

export interface WatchExecutorJobOptions {
  executorName: string;
  jobId: string;
  workspaceId?: string;
  profile?: string;
  interval?: number;
  logs?: boolean;
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

/**
 * List executor jobs for a given executor.
 * @param options - Options for listing executor jobs
 * @returns List of executor job information
 */
export async function listExecutorJobs(
  options: ListExecutorJobsOptions,
): Promise<ExecutorJobListInfo[]> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
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

  try {
    const { jobs } = await client.listExecutorJobs({
      workspaceId,
      executorName: options.executorName,
      pageSize: options.limit,
      pageDirection: PageDirection.DESC,
      filter,
    });

    return jobs.map(toExecutorJobListInfo);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Executor '${options.executorName}' not found.`);
    }
    throw error;
  }
}

/**
 * Get details of a specific executor job.
 * @param options - Options for getting executor job details
 * @returns Executor job detail information
 */
export async function getExecutorJob(
  options: GetExecutorJobOptions,
): Promise<ExecutorJobDetailInfo> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  try {
    const { job } = await client.getExecutorJob({
      workspaceId,
      executorName: options.executorName,
      jobId: options.jobId,
    });

    if (!job) {
      throw new Error(`Job '${options.jobId}' not found.`);
    }

    const jobInfo = toExecutorJobInfo(job);

    if (options.attempts) {
      const attempts = await fetchAll(async (pageToken) => {
        const { attempts, nextPageToken } = await client.listExecutorJobAttempts({
          workspaceId,
          jobId: options.jobId,
          pageToken,
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
      throw new Error(`Job '${options.jobId}' not found for executor '${options.executorName}'.`);
    }
    throw error;
  }
}

/**
 * Watch an executor job until completion, including downstream executions.
 * @param options - Options for watching executor job
 * @returns Result including job details and downstream execution info
 */
export async function watchExecutorJob(
  options: WatchExecutorJobOptions,
): Promise<WatchExecutorJobResult> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const interval = options.interval ?? 3000;
  const spinner = ora().start("Waiting for executor job to complete...");

  try {
    // Get executor details to determine target type
    const { executor } = await client.getExecutorExecutor({
      workspaceId,
      name: options.executorName,
    });

    if (!executor) {
      throw new Error(`Executor '${options.executorName}' not found.`);
    }

    const targetType = executor.targetType;
    const targetTypeStr = executorTargetTypeToString(targetType);

    // Phase 1: Wait for executor job to complete
    let job: Awaited<ReturnType<typeof client.getExecutorJob>>["job"];
    while (true) {
      const response = await client.getExecutorJob({
        workspaceId,
        executorName: options.executorName,
        jobId: options.jobId,
      });

      job = response.job;
      if (!job) {
        throw new Error(`Job '${options.jobId}' not found.`);
      }

      if (isExecutorJobTerminalStatus(job.status)) {
        break;
      }

      spinner.text = `Waiting for executor job... (${formatTime(new Date())})`;
      await setTimeout(interval);
    }

    const jobInfo = toExecutorJobInfo(job);
    const coloredStatus = colorizeExecutorJobStatus(jobInfo.status);

    if (job.status === ExecutorJobStatus.SUCCESS) {
      spinner.succeed(`Executor job completed: ${coloredStatus}`);
    } else {
      spinner.fail(`Executor job completed: ${coloredStatus}`);
    }

    // Get attempts to find operationReference
    const attempts = await fetchAll(async (pageToken) => {
      const { attempts, nextPageToken } = await client.listExecutorJobAttempts({
        workspaceId,
        jobId: options.jobId,
        pageToken,
        pageDirection: PageDirection.DESC,
      });
      return [attempts, nextPageToken];
    });

    const attemptInfos = attempts.map(toExecutorJobAttemptInfo);
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
          spinner.stop();

          try {
            // Use waitForExecution with progress display (same as workflow start)
            const executionResult = await waitForExecution({
              client,
              workspaceId,
              executionId: operationReference,
              interval,
              showProgress: true,
              trackJobs: true,
            });

            // Fetch logs if requested
            let workflowJobLogs: WorkflowJobLog[] | undefined;
            if (options.logs) {
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
            }

            return {
              job: jobDetail,
              targetType: targetTypeStr,
              workflowExecutionId: operationReference,
              workflowStatus: executionResult.status,
              workflowJobLogs,
            };
          } catch (error) {
            logger.warn(
              `Could not track workflow execution: ${error instanceof Error ? error.message : error}`,
            );
            return {
              job: jobDetail,
              targetType: targetTypeStr,
              workflowExecutionId: operationReference,
            };
          }
        }

        case ExecutorTargetType.FUNCTION:
        case ExecutorTargetType.JOB_FUNCTION:
          {
            // Wait for function execution
            spinner.start(`Waiting for function execution ${operationReference}...`);

            try {
              while (true) {
                const { execution } = await client.getFunctionExecution({
                  workspaceId,
                  executionId: operationReference,
                });

                if (!execution) {
                  throw new Error(`Function execution '${operationReference}' not found.`);
                }

                if (isFunctionExecutionTerminalStatus(execution.status)) {
                  const statusStr = functionExecutionStatusToString(execution.status);
                  const coloredFnStatus = colorizeFunctionExecutionStatus(statusStr);
                  if (execution.status === FunctionExecution_Status.SUCCESS) {
                    spinner.succeed(`Function execution completed: ${coloredFnStatus}`);
                  } else {
                    spinner.fail(`Function execution completed: ${coloredFnStatus}`);
                  }
                  return {
                    job: jobDetail,
                    targetType: targetTypeStr,
                    functionExecutionId: operationReference,
                    functionStatus: statusStr,
                    functionLogs: options.logs ? execution.logs || undefined : undefined,
                  };
                }

                spinner.text = `Waiting for function execution... (${formatTime(new Date())})`;
                await setTimeout(interval);
              }
            } catch (error) {
              spinner.warn(
                `Could not track function execution: ${error instanceof Error ? error.message : error}`,
              );
              return {
                job: jobDetail,
                targetType: targetTypeStr,
                functionExecutionId: operationReference,
              };
            }
          }
          break;
        default:
          // WEBHOOK, TAILOR_GRAPHQL, or unknown - no downstream execution to track
          break;
      }
    }

    return { job: jobDetail, targetType: targetTypeStr };
  } finally {
    spinner.stop();
  }
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

export const jobsCommand = defineCommand({
  meta: {
    name: "jobs",
    description: "List or get executor jobs",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    executorName: {
      type: "positional",
      description: "Executor name",
      required: true,
    },
    jobId: {
      type: "positional",
      description: "Job ID (if provided, shows job details)",
      required: false,
    },
    status: {
      type: "string",
      description: "Filter by status (PENDING, RUNNING, SUCCESS, FAILED, CANCELED)",
      alias: "s",
    },
    attempts: {
      type: "boolean",
      description: "Show job attempts (only with job ID)",
      default: false,
    },
    wait: {
      type: "boolean",
      description:
        "Wait for job completion and downstream execution (workflow/function) if applicable",
      default: false,
      alias: "W",
    },
    interval: {
      type: "string",
      description: "Polling interval when using --wait (e.g., '3s', '500ms', '1m')",
      default: "3s",
      alias: "i",
    },
    logs: {
      type: "boolean",
      description: "Display function execution logs after completion (requires --wait)",
      default: false,
      alias: "l",
    },
    limit: {
      type: "string",
      description: "Maximum number of jobs to list (default: 50, max: 1000)",
    },
  },
  run: withCommonArgs(async (args) => {
    if (args.jobId) {
      if (args.wait) {
        const interval = parseDuration(args.interval as string);
        const result = await watchExecutorJob({
          executorName: args.executorName as string,
          jobId: args.jobId as string,
          workspaceId: args["workspace-id"],
          profile: args.profile,
          interval,
          logs: args.logs,
        });

        // Print result
        if (!args.json) {
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
        return;
      }

      const job = await getExecutorJob({
        executorName: args.executorName as string,
        jobId: args.jobId as string,
        attempts: args.attempts,
        workspaceId: args["workspace-id"],
        profile: args.profile,
      });
      if (args.attempts && !args.json) {
        printJobWithAttempts(job);
      } else {
        logger.out(job);
      }
    } else {
      if (args.wait) {
        logger.warn("--wait flag is ignored in list mode. Specify a job ID to wait.");
      }
      const jobs = await listExecutorJobs({
        executorName: args.executorName as string,
        status: args.status,
        limit: args.limit ? Number.parseInt(args.limit, 10) : undefined,
        workspaceId: args["workspace-id"],
        profile: args.profile,
      });
      logger.out(jobs);
    }
  }),
});
