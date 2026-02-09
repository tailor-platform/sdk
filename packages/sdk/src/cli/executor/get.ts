import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import { nameArgs } from "./args";
import { type ExecutorInfo, toExecutorInfo } from "./transform";

export interface GetExecutorOptions {
  name: string;
  workspaceId?: string;
  profile?: string;
  /** If true, format for JSON output */
  jsonMode?: boolean;
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
export async function getExecutor(options: GetExecutorOptions): Promise<ExecutorInfo> {
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
    const executor = await resolveExecutor(client, workspaceId, options.name);
    return toExecutorInfo(executor, { jsonMode: options.jsonMode });
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Executor '${options.name}' not found.`);
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
      jsonMode: args.json,
    });

    logger.out(executor, {
      display: {
        triggerConfig: null,
        targetConfig: null,
      },
    });
  }),
});
