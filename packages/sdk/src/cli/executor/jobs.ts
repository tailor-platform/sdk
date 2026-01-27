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
    const jobs = await fetchAll(async (pageToken) => {
      const { jobs, nextPageToken } = await client.listExecutorJobs({
        workspaceId,
        executorName: options.executorName,
        pageToken,
        pageDirection: PageDirection.DESC,
        filter,
      });
      return [jobs, nextPageToken];
    });

    return jobs.map(toExecutorJobListInfo);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Executor '${options.executorName}' not found.`);
    }
    throw error;
  }
}

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
          // Wait for workflow execution
          spinner.start(`Waiting for workflow execution ${operationReference}...`);

          try {
            const { execution, wait } = await getWorkflowExecution({
              executionId: operationReference,
              workspaceId: options.workspaceId,
              profile: options.profile,
              interval,
              logs: options.logs,
            });

            // Helper to extract workflow job logs
            const extractWorkflowJobLogs = (
              exec: typeof execution,
            ): WorkflowJobLog[] | undefined => {
              if (!options.logs || !exec.jobDetails) return undefined;
              return exec.jobDetails
                .filter((job) => job.logs || job.result)
                .map((job) => ({
                  jobName: job.stackedJobName || job.id,
                  logs: job.logs,
                  result: job.result,
                }));
            };

            // Check if already completed
            if (execution.status === "SUCCESS" || execution.status === "FAILED") {
              if (execution.status === "SUCCESS") {
                spinner.succeed(
                  `Workflow execution completed: ${styles.success(execution.status)}`,
                );
              } else {
                spinner.fail(`Workflow execution completed: ${styles.error(execution.status)}`);
              }
              return {
                job: jobDetail,
                targetType: targetTypeStr,
                workflowExecutionId: operationReference,
                workflowStatus: execution.status,
                workflowJobLogs: extractWorkflowJobLogs(execution),
              };
            }

            // Wait for completion
            const updateInterval = setInterval(() => {
              spinner.text = `Waiting for workflow execution... (${formatTime(new Date())})`;
            }, interval);

            try {
              const finalExecution = await wait();
              if (finalExecution.status === "SUCCESS") {
                spinner.succeed(
                  `Workflow execution completed: ${styles.success(finalExecution.status)}`,
                );
              } else {
                spinner.fail(
                  `Workflow execution completed: ${styles.error(finalExecution.status)}`,
                );
              }
              return {
                job: jobDetail,
                targetType: targetTypeStr,
                workflowExecutionId: operationReference,
                workflowStatus: finalExecution.status,
                workflowJobLogs: extractWorkflowJobLogs(finalExecution),
              };
            } finally {
              clearInterval(updateInterval);
            }
          } catch (error) {
            spinner.warn(
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
                  logger.log(styles.dim("  Logs:"));
                  logger.log(jobLog.logs);
                }
                if (jobLog.result) {
                  logger.log(styles.dim("  Result:"));
                  logger.log(jobLog.result);
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
              logger.log(styles.bold("\nLogs:"));
              logger.log(result.functionLogs);
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
        workspaceId: args["workspace-id"],
        profile: args.profile,
      });
      logger.out(jobs);
    }
  }),
});
