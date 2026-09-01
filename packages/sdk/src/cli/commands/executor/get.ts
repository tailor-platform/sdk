import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { type initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
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
): Promise<ExecutorInfo> {
  const name = options.executor.name;
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options.profile,
    workspaceId: options.workspaceId,
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
  args: z.strictObject({
    ...workspaceArgs,
    ...nameArgs,
  }),
  run: async (args) => {
    const executor = await getExecutor({
      executor: { name: args.name },
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
