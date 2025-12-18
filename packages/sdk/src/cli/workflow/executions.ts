import { create } from "@bufbuild/protobuf";
import {
  Condition_Operator,
  ConditionSchema,
  FilterSchema,
  PageDirection,
} from "@tailor-proto/tailor/v1/resource_pb";
import { WorkflowExecution_Status } from "@tailor-proto/tailor/v1/workflow_resource_pb";
import { defineCommand } from "citty";
import ora from "ora";
import { table } from "table";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { printData } from "../format";
import { styles, logger } from "../utils/logger";
import {
  type WorkflowExecutionInfo,
  type WorkflowJobExecutionInfo,
  toWorkflowExecutionInfo,
  toWorkflowJobExecutionInfo,
} from "./transform";
import type { FunctionExecution } from "@tailor-proto/tailor/v1/function_resource_pb";

export interface ListWorkflowExecutionsOptions {
  workspaceId?: string;
  profile?: string;
  workflowName?: string;
  status?: string;
}

export interface GetWorkflowExecutionOptions {
  executionId: string;
  workspaceId?: string;
  profile?: string;
  interval?: number;
  logs?: boolean;
}

export interface JobExecutionLog {
  jobName: string;
  status: string;
  logs: string;
  result: string;
}

export interface WorkflowExecutionDetailInfo extends WorkflowExecutionInfo {
  jobDetails?: (WorkflowJobExecutionInfo & {
    logs?: string;
    result?: string;
  })[];
}

export interface GetWorkflowExecutionResult {
  execution: WorkflowExecutionDetailInfo;
  wait: () => Promise<WorkflowExecutionDetailInfo>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function colorizeStatus(status: WorkflowExecution_Status): string {
  const statusText = WorkflowExecution_Status[status];
  switch (status) {
    case WorkflowExecution_Status.PENDING:
      return styles.dim(statusText);
    case WorkflowExecution_Status.PENDING_RESUME:
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

function parseStatus(status: string): WorkflowExecution_Status {
  const upperStatus = status.toUpperCase();
  switch (upperStatus) {
    case "PENDING":
      return WorkflowExecution_Status.PENDING;
    case "PENDING_RESUME":
      return WorkflowExecution_Status.PENDING_RESUME;
    case "RUNNING":
      return WorkflowExecution_Status.RUNNING;
    case "SUCCESS":
      return WorkflowExecution_Status.SUCCESS;
    case "FAILED":
      return WorkflowExecution_Status.FAILED;
    default:
      throw new Error(
        `Invalid status: ${status}. Valid values: PENDING, PENDING_RESUME, RUNNING, SUCCESS, FAILED`,
      );
  }
}

export async function listWorkflowExecutions(
  options?: ListWorkflowExecutionsOptions,
): Promise<WorkflowExecutionInfo[]> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const filters: ReturnType<typeof create<typeof FilterSchema>>[] = [];

  if (options?.workflowName) {
    filters.push(
      create(FilterSchema, {
        condition: create(ConditionSchema, {
          field: "workflow_name",
          operator: Condition_Operator.EQ,
          value: { kind: { case: "stringValue", value: options.workflowName } },
        }),
      }),
    );
  }

  if (options?.status) {
    const statusValue = parseStatus(options.status);
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

  const filter =
    filters.length > 0
      ? create(FilterSchema, {
          and: filters,
        })
      : undefined;

  const executions = await fetchAll(async (pageToken) => {
    const { executions, nextPageToken } = await client.listWorkflowExecutions({
      workspaceId,
      pageToken,
      pageDirection: PageDirection.DESC,
      filter,
    });
    return [executions, nextPageToken];
  });

  return executions.map(toWorkflowExecutionInfo);
}

export async function getWorkflowExecution(
  options: GetWorkflowExecutionOptions,
): Promise<GetWorkflowExecutionResult> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  async function fetchFunctionExecution(
    functionExecutionId: string,
  ): Promise<FunctionExecution | undefined> {
    try {
      const filter = create(FilterSchema, {
        condition: create(ConditionSchema, {
          field: "id",
          operator: Condition_Operator.EQ,
          value: { kind: { case: "stringValue", value: functionExecutionId } },
        }),
      });

      const response = await client.listFunctionExecutions({
        workspaceId,
        filter,
        pageSize: 1,
      });

      return response.executions[0];
    } catch {
      return undefined;
    }
  }

  async function fetchExecutionWithLogs(
    executionId: string,
    includeLogs: boolean,
  ): Promise<WorkflowExecutionDetailInfo> {
    const { execution } = await client.getWorkflowExecution({
      workspaceId,
      executionId,
    });

    if (!execution) {
      throw new Error(`Execution '${executionId}' not found.`);
    }

    const result: WorkflowExecutionDetailInfo =
      toWorkflowExecutionInfo(execution);

    if (includeLogs && execution.jobExecutions.length > 0) {
      result.jobDetails = await Promise.all(
        execution.jobExecutions.map(async (job) => {
          const jobInfo = toWorkflowJobExecutionInfo(job);
          if (job.executionId) {
            const functionExecution = await fetchFunctionExecution(
              job.executionId,
            );
            if (functionExecution) {
              return {
                ...jobInfo,
                logs: functionExecution.logs || undefined,
                result: functionExecution.result || undefined,
              };
            }
          }
          return jobInfo;
        }),
      );
    }

    return result;
  }

  async function waitForCompletion(): Promise<WorkflowExecutionDetailInfo> {
    const interval = options.interval ?? 3000;

    while (true) {
      const { execution } = await client.getWorkflowExecution({
        workspaceId,
        executionId: options.executionId,
      });

      if (!execution) {
        throw new Error(`Execution '${options.executionId}' not found.`);
      }

      // Terminal states
      if (
        execution.status === WorkflowExecution_Status.SUCCESS ||
        execution.status === WorkflowExecution_Status.FAILED
      ) {
        return await fetchExecutionWithLogs(
          options.executionId,
          options.logs ?? false,
        );
      }

      await sleep(interval);
    }
  }

  const execution = await fetchExecutionWithLogs(
    options.executionId,
    options.logs ?? false,
  );

  return {
    execution,
    wait: waitForCompletion,
  };
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(s|ms|m)$/);
  if (!match) {
    throw new Error(
      `Invalid duration format: ${duration}. Use format like '5s', '500ms', or '1m'.`,
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

async function waitWithSpinner(
  waitFn: () => Promise<WorkflowExecutionDetailInfo>,
  interval: number,
  json: boolean,
): Promise<WorkflowExecutionDetailInfo> {
  const spinner = !json ? ora().start("Waiting...") : null;

  const updateInterval = setInterval(() => {
    if (spinner) {
      const now = formatTime(new Date());
      spinner.text = `Polling... (${now})`;
    }
  }, interval);

  try {
    const result = await waitFn();
    const coloredStatus = colorizeStatus(
      WorkflowExecution_Status[
        result.status as keyof typeof WorkflowExecution_Status
      ],
    );
    if (result.status === "SUCCESS") {
      spinner?.succeed(`Completed: ${coloredStatus}`);
    } else {
      spinner?.fail(`Completed: ${coloredStatus}`);
    }
    return result;
  } finally {
    clearInterval(updateInterval);
    spinner?.stop();
  }
}

function printExecutionWithLogs(execution: WorkflowExecutionDetailInfo): void {
  // Print execution summary
  const summaryData: [string, string][] = [
    ["id", execution.id],
    ["workflowName", execution.workflowName],
    ["status", execution.status],
    ["jobExecutions", execution.jobExecutions.toString()],
    ["startedAt", execution.startedAt],
    ["finishedAt", execution.finishedAt],
  ];
  process.stdout.write(table(summaryData, { singleLine: true }));

  // Print job details with logs
  if (execution.jobDetails && execution.jobDetails.length > 0) {
    logger.log(styles.bold("\nJob Executions:"));
    for (const job of execution.jobDetails) {
      logger.log(styles.info(`\n--- ${job.stackedJobName} ---`));
      logger.log(`  Status: ${job.status}`);
      logger.log(`  Started: ${job.startedAt}`);
      logger.log(`  Finished: ${job.finishedAt}`);

      if (job.logs) {
        logger.log(styles.warning("\n  Logs:"));
        const logLines = job.logs.split("\n");
        for (const line of logLines) {
          logger.log(`    ${line}`);
        }
      }

      if (job.result) {
        logger.log(styles.success("\n  Result:"));
        try {
          const parsed = JSON.parse(job.result);
          logger.log(
            `    ${JSON.stringify(parsed, null, 2).split("\n").join("\n    ")}`,
          );
        } catch {
          logger.log(`    ${job.result}`);
        }
      }
    }
  }
}

export const executionsCommand = defineCommand({
  meta: {
    name: "executions",
    description: "List or get workflow executions",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    executionId: {
      type: "positional",
      description: "Execution ID (if provided, shows details)",
      required: false,
    },
    "workflow-name": {
      type: "string",
      description: "Filter by workflow name (list mode only)",
      alias: "n",
    },
    status: {
      type: "string",
      description: "Filter by status (list mode only)",
      alias: "s",
    },
    wait: {
      type: "boolean",
      alias: "W",
      description: "Wait for execution to complete (detail mode only)",
      default: false,
    },
    interval: {
      type: "string",
      description: "Polling interval when using --wait",
      default: "3s",
    },
    logs: {
      type: "boolean",
      description: "Display job execution logs (detail mode only)",
      default: false,
    },
  },
  run: withCommonArgs(async (args) => {
    if (args.executionId) {
      const interval = parseDuration(args.interval);
      const { execution, wait } = await getWorkflowExecution({
        executionId: args.executionId,
        workspaceId: args["workspace-id"],
        profile: args.profile,
        interval,
        logs: args.logs,
      });

      if (!args.json) {
        logger.info(`Execution ID: ${execution.id}`, { mode: "stream" });
      }

      const result = args.wait
        ? await waitWithSpinner(wait, interval, args.json)
        : execution;

      if (args.logs && !args.json) {
        printExecutionWithLogs(result);
      } else {
        printData(result, args.json);
      }
    } else {
      const executions = await listWorkflowExecutions({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        workflowName: args["workflow-name"],
        status: args.status,
      });
      printData(executions, args.json);
    }
  }),
});
