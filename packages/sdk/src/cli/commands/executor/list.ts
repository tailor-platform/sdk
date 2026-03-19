import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger, styles } from "@/cli/shared/logger";
import { type ExecutorListInfo, toExecutorListInfo } from "./transform";

export interface ListExecutorsOptions {
  workspaceId?: string;
  profile?: string;
}

/**
 * List executors in the workspace and return CLI-friendly info.
 * @param options - Executor listing options
 * @returns List of executors
 */
export async function listExecutors(options?: ListExecutorsOptions): Promise<ExecutorListInfo[]> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const executors = await fetchAll(async (pageToken, maxPageSize) => {
    const { executors, nextPageToken } = await client.listExecutorExecutors({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [executors, nextPageToken];
  });

  return executors.map((e) => toExecutorListInfo(e));
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all executors",
  args: z
    .object({
      ...workspaceArgs,
    })
    .strict(),
  run: async (args) => {
    const executors = await listExecutors({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    if (executors.length === 0) {
      logger.info("No executors found.");
      return;
    }

    logger.out(executors, {
      display: {
        disabled: (v) => (v ? styles.warning("true") : styles.dim("false")),
      },
    });

    // Show hint if there are webhook executors (non-JSON mode only)
    if (!args.json) {
      const hasWebhook = executors.some((e) => e.triggerType === "webhook");
      if (hasWebhook) {
        logger.info("To see webhook URLs, run: tailor-sdk executor webhook list");
      }
    }
  },
});
