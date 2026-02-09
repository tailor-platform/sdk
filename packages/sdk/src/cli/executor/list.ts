import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { formatTableWithHeaders } from "../utils/format";
import { logger, styles } from "../utils/logger";
import {
  type ExecutorInfo,
  type ExecutorListInfo,
  toExecutorInfo,
  toExecutorListInfo,
} from "./transform";

export interface ListExecutorsOptions {
  workspaceId?: string;
  profile?: string;
  /** If true, format for JSON output (includes triggerConfig and targetConfig) */
  jsonMode?: boolean;
}

/**
 * List executors in the workspace and return CLI-friendly info.
 * @param options - Executor listing options
 * @returns List of executors (ExecutorInfo[] for JSON mode, ExecutorListInfo[] for table mode)
 */
export async function listExecutors(
  options?: ListExecutorsOptions,
): Promise<ExecutorListInfo[] | ExecutorInfo[]> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const executors = await fetchAll(async (pageToken) => {
    const { executors, nextPageToken } = await client.listExecutorExecutors({
      workspaceId,
      pageToken,
    });
    return [executors, nextPageToken];
  });

  // JSON mode: return full info including configs
  if (options?.jsonMode) {
    return executors.map((e) => toExecutorInfo(e, { jsonMode: true }));
  }

  return executors.map((e) => toExecutorListInfo(e));
}

export const listCommand = defineCommand({
  name: "list",
  description: "List all executors",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
  }),
  run: withCommonArgs(async (args) => {
    const executors = await listExecutors({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      jsonMode: args.json,
    });

    if (args.json) {
      logger.out(executors);
    } else {
      if (executors.length === 0) {
        logger.info("No executors found.");
        return;
      }
      const headers = ["name", "triggerType", "targetType", "disabled"];
      const rows = executors.map((e) => [
        e.name,
        e.triggerType,
        e.targetType,
        e.disabled ? styles.warning("true") : styles.dim("false"),
      ]);
      logger.out(formatTableWithHeaders(headers, rows));

      // Show hint if there are webhook executors
      const hasWebhook = executors.some(
        (e) => e.triggerType === "webhook" || e.triggerType === "INCOMING_WEBHOOK",
      );
      if (hasWebhook) {
        logger.info("To see webhook URLs, run: tailor-sdk executor webhook list");
      }
    }
  }),
});
