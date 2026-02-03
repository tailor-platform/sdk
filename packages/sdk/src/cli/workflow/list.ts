import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import { type WorkflowListInfo, toWorkflowListInfo } from "./transform";

export interface ListWorkflowsOptions {
  workspaceId?: string;
  profile?: string;
}

/**
 * List workflows in the workspace and return CLI-friendly info.
 * @param options - Workflow listing options
 * @returns List of workflows
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
  name: "list",
  description: "List all workflows in the workspace.",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
  }),
  run: withCommonArgs(async (args) => {
    const workflows = await listWorkflows({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    if (workflows.length === 0 && !args.json) {
      logger.info("No workflows found.");
      return;
    }
    logger.out(workflows);
  }),
});
