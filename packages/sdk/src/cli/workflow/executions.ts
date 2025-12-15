import { create } from "@bufbuild/protobuf";
import {
  Condition_Operator,
  ConditionSchema,
  FilterSchema,
  PageDirection,
} from "@tailor-proto/tailor/v1/resource_pb";
import { WorkflowExecution_Status } from "@tailor-proto/tailor/v1/workflow_resource_pb";
import chalk from "chalk";
import { defineCommand } from "citty";
import { default as consola } from "consola";
import ora from "ora";
import { table } from "table";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { parseFormat, printWithFormat } from "../format";
import {
  type WorkflowExecutionInfo,
  type WorkflowJobExecutionInfo,
  toWorkflowExecutionInfo,
  toWorkflowJobExecutionInfo,
} from "./transform";
import type { FunctionExecution } from "@tailor-proto/tailor/v1/function_resource_pb";

export interface WorkflowExecutionsListOptions {
  workspaceId?: string;
  profile?: string;
  workflowName?: string;
  status?: string;
}

export interface WorkflowExecutionGetOptions {
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

export interface WorkflowExecutionGetResult {
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
      return chalk.gray(statusText);
    case WorkflowExecution_Status.PENDING_RESUME:
      return chalk.yellow(statusText);
    case WorkflowExecution_Status.RUNNING:
      return chalk.cyan(statusText);
    case WorkflowExecution_Status.SUCCESS:
      return chalk.green(statusText);
    case WorkflowExecution_Status.FAILED:
      return chalk.red(statusText);
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

export async function workflowExecutionsList(
  options?: WorkflowExecutionsListOptions,
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

export async function workflowExecutionGet(
  options: WorkflowExecutionGetOptions,
): Promise<WorkflowExecutionGetResult> {
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
  format: "table" | "json",
): Promise<WorkflowExecutionDetailInfo> {
  const spinner = format !== "json" ? ora().start("Waiting...") : null;

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
    console.log(chalk.bold("\nJob Executions:"));
    for (const job of execution.jobDetails) {
      console.log(chalk.cyan(`\n--- ${job.stackedJobName} ---`));
      console.log(`  Status: ${job.status}`);
      console.log(`  Started: ${job.startedAt}`);
      console.log(`  Finished: ${job.finishedAt}`);

      if (job.logs) {
        console.log(chalk.yellow("\n  Logs:"));
        const logLines = job.logs.split("\n");
        for (const line of logLines) {
          console.log(`    ${line}`);
        }
      }

      if (job.result) {
        console.log(chalk.green("\n  Result:"));
        try {
          const parsed = JSON.parse(job.result);
          console.log(
            `    ${JSON.stringify(parsed, null, 2).split("\n").join("\n    ")}`,
          );
        } catch {
          console.log(`    ${job.result}`);
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
    executionId: {
      type: "positional",
      description: "Execution ID (if provided, shows details)",
      required: false,
    },
    "workspace-id": {
      type: "string",
      description: "Workspace ID",
      alias: "w",
    },
    profile: {
      type: "string",
      description: "Workspace profile",
      alias: "p",
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
    const format = parseFormat(args.json);

    if (args.executionId) {
      const interval = parseDuration(args.interval);
      const { execution, wait } = await workflowExecutionGet({
        executionId: args.executionId,
        workspaceId: args["workspace-id"],
        profile: args.profile,
        interval,
        logs: args.logs,
      });

      if (format !== "json") {
        consola.info(`Execution ID: ${execution.id}`);
      }

      const result = args.wait
        ? await waitWithSpinner(wait, interval, format)
        : execution;

      if (args.logs && format === "table") {
        printExecutionWithLogs(result);
      } else {
        printWithFormat(result, format);
      }
    } else {
      const executions = await workflowExecutionsList({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        workflowName: args["workflow-name"],
        status: args.status,
      });
      printWithFormat(executions, format);
    }
  }),
});
