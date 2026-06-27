import { z } from "zod";
import { type Order, paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger, styles } from "#/cli/shared/logger";
import { type ExecutorListInfo, toExecutorListInfo } from "./transform";

export interface ListExecutorsOptions {
  workspaceId?: string;
  profile?: string;
  order?: Order;
  limit?: number;
}

/**
 * List executors in the workspace and return CLI-friendly info.
 * @param options - Executor listing options
 * @returns List of executors
 */
export async function listExecutors(options?: ListExecutorsOptions): Promise<ExecutorListInfo[]> {
  const accessToken = await loadAccessToken({
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const pageDirection = toPageDirection(options?.order);
  const executors = await fetchPaged(
    async (pageToken, pageSize) => {
      const { executors, nextPageToken } = await client.listExecutorExecutors({
        workspaceId,
        pageToken,
        pageSize,
        pageDirection,
      });
      return [executors, nextPageToken];
    },
    { limit: options?.limit },
  );

  return executors.map((e) => toExecutorListInfo(e));
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all executors",
  args: z
    .object({
      ...workspaceArgs,
      ...paginationArgs(),
    })
    .strict(),
  run: async (args) => {
    const jsonOutput = logger.jsonMode;
    const executors = await listExecutors({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      order: args.order,
      limit: args.limit,
    });

    if (executors.length === 0) {
      logger.info("No executors found.");
      if (jsonOutput) {
        logger.out([]);
      }
      return;
    }

    logger.out(executors, {
      display: {
        disabled: (v) => (v ? styles.warning("true") : styles.dim("false")),
      },
    });

    // Show hint if there are webhook executors (non-JSON mode only)
    if (!jsonOutput) {
      const hasWebhook = executors.some((e) => e.triggerType === "webhook");
      if (hasWebhook) {
        logger.info("To see webhook URLs, run: tailor executor webhook list");
      }
    }
  },
});
