import { z } from "zod";
import { type Order, paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { fetchWithinLimit, reportTruncation } from "#/cli/shared/limit";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { type WorkflowListInfo, toWorkflowListInfo } from "./transform";

export interface ListWorkflowsOptions {
  workspaceId?: string;
  profile?: string;
  order?: Order;
  limit?: number;
}

/**
 * List workflows in the workspace and return CLI-friendly info.
 * @param options - Workflow listing options
 * @returns List of workflows
 */
export async function listWorkflows(options?: ListWorkflowsOptions): Promise<WorkflowListInfo[]> {
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options?.profile,
    workspaceId: options?.workspaceId,
  });

  const pageDirection = toPageDirection(options?.order);
  const workflows = await fetchPaged(
    async (pageToken, pageSize) => {
      const { workflows, nextPageToken } = await client.listWorkflows({
        workspaceId,
        pageToken,
        pageSize,
        pageDirection,
      });
      return [workflows, nextPageToken];
    },
    { limit: options?.limit },
  );

  return workflows.map(toWorkflowListInfo);
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all workflows in the workspace.",
  args: z.strictObject({
    ...workspaceArgs,
    ...paginationArgs(),
  }),
  run: async (args) => {
    const jsonOutput = logger.jsonMode;
    const listed = await fetchWithinLimit(args.limit, (limit) =>
      listWorkflows({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        order: args.order,
        limit,
      }),
    );
    const workflows = listed.items;

    if (workflows.length === 0) {
      logger.info("No workflows found.");
      if (!jsonOutput) {
        return;
      }
    }
    logger.out(workflows);
    await reportTruncation(listed, args.limit);
  },
});
