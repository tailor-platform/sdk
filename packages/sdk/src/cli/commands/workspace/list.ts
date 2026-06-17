import { z } from "zod";
import { type Order, paginationArgs, toPageDirection } from "#src/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadAccessToken } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import {
  workspaceInfosWithFolderNames,
  workspaceNameTransformer,
  type WorkspaceInfo,
} from "./transform";

export interface ListWorkspacesOptions {
  order?: Order;
  limit?: number;
}

/**
 * List workspaces with an optional order and limit.
 * @param options - Workspace listing options
 * @returns List of workspaces
 */
export async function listWorkspaces(options?: ListWorkspacesOptions): Promise<WorkspaceInfo[]> {
  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const pageDirection = toPageDirection(options?.order);
  const workspaces = await fetchPaged(
    async (pageToken, pageSize) => {
      const { workspaces, nextPageToken } = await client.listWorkspaces({
        pageToken,
        pageSize,
        pageDirection,
      });
      return [workspaces, nextPageToken];
    },
    { limit: options?.limit },
  );

  return workspaceInfosWithFolderNames(client, workspaces);
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all Tailor Platform workspaces.",
  args: z
    .object({
      ...paginationArgs(),
    })
    .strict(),
  run: async (args) => {
    const workspaces = await listWorkspaces({
      order: args.order,
      limit: args.limit,
    });
    logger.out(workspaces, {
      display: { name: workspaceNameTransformer, folderName: null, updatedAt: null },
    });
  },
});
