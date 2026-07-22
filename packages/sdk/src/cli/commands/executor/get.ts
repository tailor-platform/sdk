import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { type ExecutorInfo, toExecutorInfo } from "./transform";

type ExecutorLike = {
  name: string;
};

const nameArgs = {
  name: arg(z.string(), {
    positional: true,
    description: "Executor name",
  }),
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
  // Discriminant: legacy options have top-level 'name', typed options use 'executor'.
  const name = "name" in options ? options.name : options.executor.name;
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  try {
    const executor = await resolveExecutor(client, workspaceId, name);
    return toExecutorInfo(executor);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Executor '${name}' not found.`, { cause: error });
    }
    throw error;
  }
}

export const getCommand = defineAppCommand({
  name: "get",
  description: "Get executor details",
  args: z
    .object({
      ...workspaceArgs,
      ...nameArgs,
    })
    .strict(),
  run: async (args) => {
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
  },
});
