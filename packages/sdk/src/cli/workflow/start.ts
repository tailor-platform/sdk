import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AuthInvokerSchema } from "@tailor-proto/tailor/v1/auth_resource_pb";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-proto/tailor/v1/workflow_resource_pb";
import chalk from "chalk";
import { defineCommand } from "citty";
import { default as consola } from "consola";
import ora from "ora";
import {
  commonArgs,
  formatArgs,
  parseFormat,
  printWithFormat,
  withCommonArgs,
} from "../args";
import { initOperatorClient } from "../client";
import { loadConfig } from "../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../context";
import {
  type WorkflowExecutionInfo,
  type WorkflowStartResult,
  toWorkflowExecutionInfo,
} from "./transform";
import type { WorkflowExecution } from "@tailor-proto/tailor/v1/workflow_resource_pb";

export interface WorkflowStartOptions {
  nameOrId: string;
  machineUser: string;
  arg?: string;
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  wait?: boolean;
  interval?: number;
  format: "table" | "json";
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value: string): boolean {
  return UUID_REGEX.test(value);
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

export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(s|ms|m)$/);
  if (!match) {
    throw new Error(
      `Invalid duration format: ${duration}. Use format like '3s', '500ms', or '1m'.`,
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

export interface WaitForExecutionOptions {
  client: Awaited<ReturnType<typeof initOperatorClient>>;
  workspaceId: string;
  executionId: string;
  interval: number;
  format: "table" | "json";
  trackJobs?: boolean;
}

export async function waitForExecution(
  options: WaitForExecutionOptions,
): Promise<WorkflowExecutionInfo> {
  const { client, workspaceId, executionId, interval, format, trackJobs } =
    options;

  // Show execution ID for tracking when waiting
  if (format !== "json") {
    consola.info(`Execution ID: ${executionId}`);
  }

  let lastStatus: WorkflowExecution_Status | undefined;
  let lastRunningJobs: string | undefined;
  const spinner = format !== "json" ? ora().start("Waiting...") : null;

  try {
    while (true) {
      const { execution } = await client.getWorkflowExecution({
        workspaceId,
        executionId,
      });

      if (!execution) {
        spinner?.fail(`Execution '${executionId}' not found.`);
        throw new Error(`Execution '${executionId}' not found.`);
      }

      const now = formatTime(new Date());
      const coloredStatus = colorizeStatus(execution.status);

      // Show workflow status change (persist previous line)
      if (execution.status !== lastStatus) {
        if (format !== "json") {
          spinner?.stop();
          consola.info(`Status: ${coloredStatus}`);
          spinner?.start(`Polling...`);
        }
        lastStatus = execution.status;
      }

      // Show job execution details when running (optional)
      if (trackJobs && execution.status === WorkflowExecution_Status.RUNNING) {
        const runningJobs = getRunningJobs(execution);
        if (runningJobs && runningJobs !== lastRunningJobs) {
          if (format !== "json") {
            spinner?.stop();
            consola.info(`Job | ${runningJobs}: ${coloredStatus}`);
            spinner?.start(`Polling...`);
          }
          lastRunningJobs = runningJobs;
        }
      }

      if (spinner) {
        spinner.text = `Polling... (${now})`;
      }

      // Terminal states: SUCCESS, FAILED, or PENDING_RESUME
      if (isTerminalStatus(execution.status)) {
        if (execution.status === WorkflowExecution_Status.SUCCESS) {
          spinner?.succeed(`Completed: ${coloredStatus}`);
        } else if (execution.status === WorkflowExecution_Status.FAILED) {
          spinner?.fail(`Completed: ${coloredStatus}`);
        } else {
          spinner?.warn(`Completed: ${coloredStatus}`);
        }
        return toWorkflowExecutionInfo(execution);
      }

      await sleep(interval);
    }
  } catch (error) {
    spinner?.stop();
    throw error;
  }
}

function getRunningJobs(execution: WorkflowExecution): string {
  return execution.jobExecutions
    .filter((job) => job.status === WorkflowJobExecution_Status.RUNNING)
    .map((job) => job.stackedJobName)
    .join(", ");
}

function isTerminalStatus(status: WorkflowExecution_Status): boolean {
  return (
    status === WorkflowExecution_Status.SUCCESS ||
    status === WorkflowExecution_Status.FAILED ||
    status === WorkflowExecution_Status.PENDING_RESUME
  );
}

async function resolveWorkflowId(
  client: Awaited<ReturnType<typeof initOperatorClient>>,
  workspaceId: string,
  nameOrId: string,
): Promise<string> {
  if (isUUID(nameOrId)) {
    return nameOrId;
  }

  const { workflow } = await client.getWorkflowByName({
    workspaceId,
    workflowName: nameOrId,
  });
  if (!workflow) {
    throw new Error(`Workflow '${nameOrId}' not found.`);
  }
  return workflow.id;
}

export async function workflowStart(
  options: WorkflowStartOptions,
): Promise<WorkflowStartResult | WorkflowExecutionInfo> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const { config } = await loadConfig(options.configPath);
  const { application } = await client.getApplication({
    workspaceId,
    applicationName: config.name,
  });
  if (!application?.authNamespace) {
    throw new Error(
      `Application ${config.name} does not have an auth configuration.`,
    );
  }

  try {
    const workflowId = await resolveWorkflowId(
      client,
      workspaceId,
      options.nameOrId,
    );

    const authInvoker = create(AuthInvokerSchema, {
      namespace: application.authNamespace,
      machineUserName: options.machineUser,
    });

    const { executionId } = await client.testStartWorkflow({
      workspaceId,
      workflowId,
      authInvoker,
      arg: options.arg,
    });

    if (!options.wait) {
      return { executionId };
    }

    return await waitForExecution({
      client,
      workspaceId,
      executionId,
      interval: options.interval ?? 3000,
      format: options.format,
      trackJobs: true,
    });
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Workflow '${options.nameOrId}' not found.`);
    }
    throw error;
  }
}

export const startCommand = defineCommand({
  meta: {
    name: "start",
    description: "Start a workflow execution",
  },
  args: {
    ...commonArgs,
    ...formatArgs,
    nameOrId: {
      type: "positional",
      description: "Workflow name or ID",
      required: true,
    },
    machineuser: {
      type: "string",
      description: "Machine user name",
      alias: "m",
      required: true,
    },
    arg: {
      type: "string",
      description: "Workflow argument (JSON string)",
      alias: "g",
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
    config: {
      type: "string",
      description: "Path to SDK config file",
      alias: "c",
      default: "tailor.config.ts",
    },
    wait: {
      type: "boolean",
      description: "Wait for execution to complete",
      default: false,
    },
    interval: {
      type: "string",
      description: "Polling interval when using --wait",
      default: "3s",
    },
  },
  run: withCommonArgs(async (args) => {
    const format = parseFormat(args.format);
    const interval = parseDuration(args.interval);

    const result = await workflowStart({
      nameOrId: args.nameOrId,
      machineUser: args.machineuser,
      arg: args.arg,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      wait: args.wait,
      interval,
      format,
    });

    printWithFormat(result, format);
  }),
});
