import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
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
  const workspaceId = await loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const workflows = await fetchAll(async (pageToken, maxPageSize) => {
    const { workflows, nextPageToken } = await client.listWorkflows({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [workflows, nextPageToken];
  });

  return workflows.map(toWorkflowListInfo);
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all workflows in the workspace.",
  args: z
    .object({
      ...workspaceArgs,
    })
    .strict(),
  run: async (args) => {
    const workflows = await listWorkflows({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    if (workflows.length === 0 && !args.json) {
      logger.info("No workflows found.");
      return;
    }
    logger.out(workflows);
  },
});
