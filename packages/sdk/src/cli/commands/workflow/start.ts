import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AuthInvokerSchema } from "@tailor-platform/tailor-proto/auth_resource_pb";
import { arg } from "politty";
import { z } from "zod";
import { deploymentArgs, parseDuration } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadMachineUserName, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { nameArgs, waitArgs } from "./args";
import { getWorkflowExecution, printExecutionWithLogs } from "./executions";
import { resolveWorkflow } from "./get";
import { type WorkflowWaitUntil } from "./status";
import {
  getWorkflowWaitFailureMessage,
  waitForWorkflowExecution,
  type WorkflowWaitResult,
} from "./waiter";
// Import from the public entry (not `@/types/auth`) so the `./cli` d.ts references
// `@tailor-platform/sdk` externally instead of inlining the registry — a single
// generated `declare module "@tailor-platform/sdk"` then narrows both entries.
import type { MachineUserName } from "@tailor-platform/sdk";
import type { Jsonifiable } from "type-fest";

type WorkflowLike = {
  name: string;
  mainJob: {
    body: unknown;
  };
};

type WorkflowInvoker<M extends string = string> = {
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
  machineUser?: string;
  arg?: Jsonifiable;
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  interval?: number;
}

type StartWorkflowTypedBaseOptions<W extends WorkflowLike> = {
  workflow: W;
  invoker: MachineUserName;
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  interval?: number;
};

export type StartWorkflowTypedOptions<W extends WorkflowLike = WorkflowLike> =
  W extends WorkflowLike ? StartWorkflowTypedBaseOptions<W> & StartWorkflowArgOption<W> : never;

export { waitForWorkflowExecution as waitForExecution };

export interface WaitOptions {
  showProgress?: boolean;
  timeout?: number;
  until?: WorkflowWaitUntil;
}

export interface StartWorkflowResultWithWait {
  executionId: string;
  wait: (options?: WaitOptions) => Promise<WorkflowWaitResult>;
}

interface StartWorkflowCoreOptions {
  client: Awaited<ReturnType<typeof initOperatorClient>>;
  workspaceId: string;
  workflowName: string;
  invoker: WorkflowInvoker<string>;
  arg?: unknown;
  interval?: number;
}

async function startWorkflowCore(
  options: StartWorkflowCoreOptions,
): Promise<StartWorkflowResultWithWait> {
  const { client, workspaceId, workflowName } = options;

  try {
    const workflow = await resolveWorkflow(client, workspaceId, workflowName);
    const invoker = create(AuthInvokerSchema, options.invoker);
    const arg =
      options.arg === undefined
        ? undefined
        : typeof options.arg === "string"
          ? options.arg
          : JSON.stringify(options.arg);

    const { executionId } = await client.testStartWorkflow({
      workspaceId,
      workflowId: workflow.id,
      authInvoker: invoker,
      arg,
    });

    return {
      executionId,
      wait: (waitOptions?: WaitOptions) =>
        waitForWorkflowExecution({
          client,
          workspaceId,
          executionId,
          interval: options.interval ?? 3000,
          timeout: waitOptions?.timeout,
          until: waitOptions?.until,
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

async function resolveApplicationAuthNamespace(options: {
  client: Awaited<ReturnType<typeof initOperatorClient>>;
  workspaceId: string;
  configPath?: string;
}): Promise<string> {
  const { config } = await loadConfig(options.configPath);
  const { application } = await options.client.getApplication({
    workspaceId: options.workspaceId,
    applicationName: config.name,
  });
  const authNamespace = application?.authNamespace || config.auth?.name;
  if (!authNamespace) {
    throw new Error(`Application ${config.name} does not have an auth configuration.`);
  }
  return authNamespace;
}

async function startWorkflowByName(
  options: StartWorkflowOptions,
): Promise<StartWorkflowResultWithWait> {
  const machineUser = await loadMachineUserName({
    machineUser: options.machineUser,
    profile: options.profile,
  });
  if (!machineUser) {
    throw new Error(
      "Machine user is required. Specify --machine-user, set TAILOR_PLATFORM_MACHINE_USER_NAME, or set a profile default with 'tailor profile update <profile> --machine-user <name>'.",
    );
  }

  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const authNamespace = await resolveApplicationAuthNamespace({
    client,
    workspaceId,
    configPath: options.configPath,
  });

  return await startWorkflowCore({
    client,
    workspaceId,
    workflowName: options.name,
    invoker: {
      namespace: authNamespace,
      machineUserName: machineUser,
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
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });
  const authNamespace = await resolveApplicationAuthNamespace({
    client,
    workspaceId,
    configPath: options.configPath,
  });

  return await startWorkflowCore({
    client,
    workspaceId,
    workflowName: options.workflow.name,
    invoker: {
      namespace: authNamespace,
      machineUserName: options.invoker,
    },
    arg: options.arg,
    interval: options.interval,
  });
}

export const startCommand = defineAppCommand({
  name: "start",
  description: "Start a workflow execution.",
  args: z.strictObject({
    ...deploymentArgs,
    ...nameArgs,
    "machine-user": arg(z.string().optional(), {
      alias: "m",
      description: "Machine user name. Falls back to the active profile's default machine user.",
      env: "TAILOR_PLATFORM_MACHINE_USER_NAME",
    }),
    arg: arg(z.string().optional(), {
      alias: "a",
      description: "Workflow argument (JSON string)",
    }),
    ...waitArgs,
  }),
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
    const jsonOutput = logger.jsonMode;

    logger.info(`Execution ID: ${executionId}`, { mode: "stream" });

    if (args.wait) {
      const result = await wait({
        showProgress: !jsonOutput,
        timeout: parseDuration(args.timeout),
        until: args.until,
      });
      if (args.logs && !jsonOutput) {
        const { execution } = await getWorkflowExecution({
          executionId,
          workspaceId: args["workspace-id"],
          profile: args.profile,
          logs: true,
        });
        printExecutionWithLogs(execution);
      } else if (args.logs) {
        const { execution } = await getWorkflowExecution({
          executionId,
          workspaceId: args["workspace-id"],
          profile: args.profile,
          logs: true,
        });
        logger.out({ ...result, jobDetails: execution.jobDetails });
      } else {
        logger.out(result);
      }
      const failureMessage = getWorkflowWaitFailureMessage(result, args.until);
      if (failureMessage) {
        throw new Error(failureMessage);
      }
    } else {
      logger.out({ executionId });
    }
  },
});
