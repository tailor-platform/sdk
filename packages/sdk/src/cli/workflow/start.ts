import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AuthInvokerSchema } from "@tailor-proto/tailor/v1/auth_resource_pb";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-proto/tailor/v1/workflow_resource_pb";
import { defineCommand } from "citty";
import ora from "ora";
import { commonArgs, deploymentArgs, jsonArgs, parseDuration, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadConfig } from "../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { printData } from "../utils/format";
import { logger, styles } from "../utils/logger";
import { nameArgs, waitArgs } from "./args";
import { getWorkflowExecution, printExecutionWithLogs } from "./executions";
import { resolveWorkflow } from "./get";
import { type WorkflowExecutionInfo, toWorkflowExecutionInfo } from "./transform";
import type { WorkflowExecution } from "@tailor-proto/tailor/v1/workflow_resource_pb";
import type { Jsonifiable } from "type-fest";

export interface StartWorkflowOptions {
  name: string;
  machineUser: string;
  arg?: Jsonifiable;
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  interval?: number;
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

export interface WaitForExecutionOptions {
  client: Awaited<ReturnType<typeof initOperatorClient>>;
  workspaceId: string;
  executionId: string;
  interval: number;
  showProgress?: boolean;
  trackJobs?: boolean;
}

export async function waitForExecution(
  options: WaitForExecutionOptions,
): Promise<WorkflowExecutionInfo> {
  const { client, workspaceId, executionId, interval, showProgress, trackJobs } = options;

  let lastStatus: WorkflowExecution_Status | undefined;
  let lastRunningJobs: string | undefined;
  const spinner = showProgress ? ora().start("Waiting...") : null;

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
        if (showProgress) {
          spinner?.stop();
          logger.info(`Status: ${coloredStatus}`, { mode: "stream" });
          spinner?.start(`Polling...`);
        }
        lastStatus = execution.status;
      }

      // Show job execution details when running (optional)
      if (trackJobs && execution.status === WorkflowExecution_Status.RUNNING) {
        const runningJobs = getRunningJobs(execution);
        if (runningJobs && runningJobs !== lastRunningJobs) {
          if (showProgress) {
            spinner?.stop();
            logger.info(`Job | ${runningJobs}: ${coloredStatus}`, {
              mode: "stream",
            });
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

export interface WaitOptions {
  showProgress?: boolean;
}

export interface StartWorkflowResultWithWait {
  executionId: string;
  wait: (options?: WaitOptions) => Promise<WorkflowExecutionInfo>;
}

export async function startWorkflow(
  options: StartWorkflowOptions,
): Promise<StartWorkflowResultWithWait> {
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
    throw new Error(`Application ${config.name} does not have an auth configuration.`);
  }

  try {
    const workflow = await resolveWorkflow(client, workspaceId, options.name);

    const authInvoker = create(AuthInvokerSchema, {
      namespace: application.authNamespace,
      machineUserName: options.machineUser,
    });

    const arg =
      options.arg === undefined
        ? undefined
        : typeof options.arg === "string"
          ? options.arg
          : JSON.stringify(options.arg);

    const { executionId } = await client.testStartWorkflow({
      workspaceId,
      workflowId: workflow.id,
      authInvoker,
      arg,
    });

    return {
      executionId,
      wait: (waitOptions?: WaitOptions) =>
        waitForExecution({
          client,
          workspaceId,
          executionId,
          interval: options.interval ?? 3000,
          showProgress: waitOptions?.showProgress,
          trackJobs: true,
        }),
    };
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Workflow '${options.name}' not found.`);
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
    ...jsonArgs,
    ...deploymentArgs,
    ...nameArgs,
    machineuser: {
      type: "string",
      description: "Machine user name",
      alias: "m",
      required: true,
    },
    arg: {
      type: "string",
      description: "Workflow argument (JSON string)",
      alias: "a",
    },
    ...waitArgs,
  },
  run: withCommonArgs(async (args) => {
    const interval = parseDuration(args.interval);

    const { executionId, wait } = await startWorkflow({
      name: args.name,
      machineUser: args.machineuser,
      arg: args.arg,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      interval,
    });

    logger.info(`Execution ID: ${executionId}`, { mode: "stream" });

    if (args.wait) {
      const result = await wait({ showProgress: true });
      if (args.logs && !args.json) {
        const { execution } = await getWorkflowExecution({
          executionId,
          workspaceId: args["workspace-id"],
          profile: args.profile,
          logs: true,
        });
        printExecutionWithLogs(execution);
      } else {
        printData(result, args.json);
      }
    } else {
      printData({ executionId }, args.json);
    }
  }),
});
