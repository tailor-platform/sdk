import { Code, ConnectError } from "@connectrpc/connect";
import { arg, defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import { type ExecutorInfo, toExecutorInfo } from "./transform";

const nameArgs = {
  name: arg(z.string(), {
    positional: true,
    description: "Executor name",
  }),
};

type ExecutorLike = {
  name: string;
};

export type GetExecutorTypedOptions<E extends ExecutorLike = ExecutorLike> = {
  executor: E;
  workspaceId?: string;
  profile?: string;
};

/**
 * @deprecated Use GetExecutorTypedOptions instead.
 */
export interface GetExecutorOptions {
  name: string;
  workspaceId?: string;
  profile?: string;
}

/**
 * Resolve an executor by name.
 * @param client - Operator client
 * @param workspaceId - Workspace ID
 * @param name - Executor name
 * @returns Resolved executor
 */
async function resolveExecutor(
  client: Awaited<ReturnType<typeof initOperatorClient>>,
  workspaceId: string,
  name: string,
) {
  const { executor } = await client.getExecutorExecutor({
    workspaceId,
    name,
  });
  if (!executor) {
    throw new Error(`Executor '${name}' not found.`);
  }
  return executor;
}

/**
 * Get an executor by name and return CLI-friendly info.
 * @param options - Executor lookup options
 * @returns Executor information
 */
export async function getExecutor<E extends ExecutorLike>(
  options: GetExecutorTypedOptions<E>,
): Promise<ExecutorInfo>;
export async function getExecutor(options: GetExecutorOptions): Promise<ExecutorInfo>;
export async function getExecutor<E extends ExecutorLike>(
  options: GetExecutorOptions | GetExecutorTypedOptions<E>,
): Promise<ExecutorInfo> {
  const name = "name" in options ? options.name : options.executor.name;
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
    const executor = await resolveExecutor(client, workspaceId, name);
    return toExecutorInfo(executor);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Executor '${name}' not found.`);
    }
    throw error;
  }
}

export const getCommand = defineCommand({
  name: "get",
  description: "Get executor details",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    ...nameArgs,
  }),
  run: withCommonArgs(async (args) => {
    const executor = await getExecutor({
      name: args.name,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    logger.out(executor, {
      display: {
        triggerConfig: null,
        targetConfig: null,
      },
    });
  }),
});
