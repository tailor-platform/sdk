import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AuthInvokerSchema } from "@tailor-proto/tailor/v1/auth_resource_pb";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-proto/tailor/v1/workflow_resource_pb";
import ora from "ora";
import { arg } from "politty";
import { z } from "zod";
import { deploymentArgs, parseDuration } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger, styles } from "@/cli/shared/logger";
import { nameArgs, waitArgs } from "./args";
import { getWorkflowExecution, printExecutionWithLogs } from "./executions";
import { resolveWorkflow } from "./get";
import { type WorkflowExecutionInfo, toWorkflowExecutionInfo } from "./transform";
import type { WorkflowExecution } from "@tailor-proto/tailor/v1/workflow_resource_pb";
import type { Jsonifiable } from "type-fest";

type WorkflowLike = {
  name: string;
  mainJob: {
    body: unknown;
  };
};

type AuthInvoker<M extends string = string> = {
  namespace: string;
  machineUserName: M;
};

type WorkflowInput<W extends WorkflowLike> = W extends WorkflowLike
  ? W["mainJob"]["body"] extends (...args: infer Args) => unknown
    ? Args[0]
    : never
  : never;

type StartWorkflowArgOptionForSingleWorkflow<W extends WorkflowLike> = WorkflowLike extends W
  ? { arg?: Jsonifiable }
  : undefined extends WorkflowInput<W>
    ? { arg?: WorkflowInput<W> }
    : { arg: WorkflowInput<W> };

type StartWorkflowArgOption<W extends WorkflowLike> = W extends WorkflowLike
  ? StartWorkflowArgOptionForSingleWorkflow<W>
  : never;

/**
 * @deprecated Use StartWorkflowTypedOptions instead.
 */
export interface StartWorkflowOptions {
  name: string;
  machineUser: string;
  arg?: Jsonifiable;
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  interval?: number;
}

type StartWorkflowTypedBaseOptions<W extends WorkflowLike> = {
  workflow: W;
  authInvoker: AuthInvoker<string>;
  workspaceId?: string;
  profile?: string;
  interval?: number;
};

export type StartWorkflowTypedOptions<W extends WorkflowLike = WorkflowLike> =
  W extends WorkflowLike ? StartWorkflowTypedBaseOptions<W> & StartWorkflowArgOption<W> : never;

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

/**
 * Wait for a workflow execution to reach a terminal state, optionally showing progress.
 * @param options - Wait options
 * @returns Final workflow execution info
 */
export async function waitForExecution(
  options: WaitForExecutionOptions,
): Promise<WorkflowExecutionInfo> {
  const { client, workspaceId, executionId, interval, showProgress, trackJobs } = options;

  let lastStatus: WorkflowExecution_Status | undefined;
  let lastRunningJobs: string | undefined;
  // discardStdin: false keeps stdin in cooked mode so the terminal delivers SIGINT on Ctrl+C.
  const spinner = showProgress
    ? ora({ indent: 2, discardStdin: false }).start("Waiting for workflow to complete...")
    : null;

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
          logger.info(`Status: ${coloredStatus}`, {
            mode: "stream",
            indent: 2,
          });
          spinner?.start(`Waiting for workflow to complete...`);
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
              indent: 2,
            });
            spinner?.start(`Waiting for workflow to complete...`);
          }
          lastRunningJobs = runningJobs;
        }
      }

      if (spinner) {
        spinner.text = `Waiting for workflow to complete... (${now})`;
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

interface StartWorkflowCoreOptions {
  client: Awaited<ReturnType<typeof initOperatorClient>>;
  workspaceId: string;
  workflowName: string;
  authInvoker: AuthInvoker<string>;
  arg?: unknown;
  interval?: number;
}

async function startWorkflowCore(
  options: StartWorkflowCoreOptions,
): Promise<StartWorkflowResultWithWait> {
  const { client, workspaceId, workflowName } = options;

  try {
    const workflow = await resolveWorkflow(client, workspaceId, workflowName);
    const authInvoker = create(AuthInvokerSchema, options.authInvoker);
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
      throw new Error(`Workflow '${workflowName}' not found.`, { cause: error });
    }
    throw error;
  }
}

async function startWorkflowByName(
  options: StartWorkflowOptions,
): Promise<StartWorkflowResultWithWait> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
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

  return await startWorkflowCore({
    client,
    workspaceId,
    workflowName: options.name,
    authInvoker: {
      namespace: application.authNamespace,
      machineUserName: options.machineUser,
    },
    arg: options.arg,
    interval: options.interval,
  });
}

/**
 * Start a workflow and return a handle to wait for completion.
 * @param options - Start options
 * @returns Start result with wait helper
 */
export async function startWorkflow<W extends WorkflowLike>(
  options: StartWorkflowTypedOptions<W>,
): Promise<StartWorkflowResultWithWait>;
export async function startWorkflow(
  options: StartWorkflowOptions,
): Promise<StartWorkflowResultWithWait>;
export async function startWorkflow<W extends WorkflowLike>(
  options: StartWorkflowOptions | StartWorkflowTypedOptions<W>,
): Promise<StartWorkflowResultWithWait> {
  // Keep backward compatibility: if both legacy and typed keys are present, prefer legacy shape.
  if ("name" in options) {
    return await startWorkflowByName(options);
  }

  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  return await startWorkflowCore({
    client,
    workspaceId,
    workflowName: options.workflow.name,
    authInvoker: options.authInvoker,
    arg: options.arg,
    interval: options.interval,
  });
}

export const startCommand = defineAppCommand({
  name: "start",
  description: "Start a workflow execution.",
  args: z
    .object({
      ...deploymentArgs,
      ...nameArgs,
      "machine-user": arg(z.string(), {
        alias: "m",
        hiddenAlias: "machineuser",
        description: "Machine user name",
        env: "TAILOR_PLATFORM_MACHINE_USER_NAME",
      }),
      arg: arg(z.string().optional(), {
        alias: "a",
        description: "Workflow argument (JSON string)",
      }),
      ...waitArgs,
    })
    .strict(),
  run: async (args) => {
    const { executionId, wait } = await startWorkflowByName({
      name: args.name,
      machineUser: args["machine-user"],
      arg: args.arg,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      interval: parseDuration(args.interval),
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
        logger.out(result);
      }
    } else {
      logger.out({ executionId });
    }
  },
});
