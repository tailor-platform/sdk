import { defineCommand } from "citty";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { formatTableWithHeaders, humanizeRelativeTime } from "../utils/format";
import { logger } from "../utils/logger";
import { type WorkflowListInfo, toWorkflowListInfo } from "./transform";

export interface ListWorkflowsOptions {
  workspaceId?: string;
  profile?: string;
}

/**
 * List workflows in the workspace and return CLI-friendly info.
 * @param {ListWorkflowsOptions} [options] - Workflow listing options
 * @returns {Promise<WorkflowListInfo[]>} List of workflows
 */
export async function listWorkflows(options?: ListWorkflowsOptions): Promise<WorkflowListInfo[]> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const workflows = await fetchAll(async (pageToken) => {
    const { workflows, nextPageToken } = await client.listWorkflows({
      workspaceId,
      pageToken,
    });
    return [workflows, nextPageToken];
  });

  return workflows.map(toWorkflowListInfo);
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all workflows",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
  },
  run: withCommonArgs(async (args) => {
    const workflows = await listWorkflows({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    if (args.json) {
      logger.out(workflows);
    } else {
      if (workflows.length === 0) {
        logger.info("No workflows found.");
        return;
      }
      const headers = ["name", "mainJob", "jobFunctions", "updatedAt"];
      const rows = workflows.map((w) => [
        w.name,
        w.mainJob,
        w.jobFunctions.toString(),
        humanizeRelativeTime(w.updatedAt),
      ]);
      logger.out(formatTableWithHeaders(headers, rows));
    }
  }),
});
