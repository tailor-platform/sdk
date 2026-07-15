import { arg } from "politty";
import { z } from "zod";
import { type Order, paginationArgs, toPageDirection } from "#/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadPlatformClientConfig } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { profileNameSchema } from "#/cli/shared/profile-name";
import {
  workspaceInfosWithFolderNames,
  workspaceNameTransformer,
  type WorkspaceInfo,
} from "./transform";

export interface ListWorkspacesOptions {
  order?: Order;
  limit?: number;
  profile?: string;
}

/**
 * List workspaces with an optional order and limit.
 * @param options - Workspace listing options
 * @returns List of workspaces
 */
export async function listWorkspaces(options?: ListWorkspacesOptions): Promise<WorkspaceInfo[]> {
  const profile = profileNameSchema.optional().parse(options?.profile);
  const accessToken = await loadAccessToken({ profile });
  const platformConfig = await loadPlatformClientConfig({ profile });
  const client = await initOperatorClient(accessToken, platformConfig);
  return listWorkspacesWithClient(client, options);
}

/**
 * List workspaces using an existing Operator client.
 * @param client - Authenticated Operator client
 * @param options - Workspace listing options
 * @returns List of workspaces
 */
export async function listWorkspacesWithClient(
  client: Parameters<typeof workspaceInfosWithFolderNames>[0],
  options?: ListWorkspacesOptions,
): Promise<WorkspaceInfo[]> {
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
      profile: arg(profileNameSchema.optional(), {
        description: "Workspace profile used for authentication and Platform selection",
        env: "TAILOR_PLATFORM_PROFILE",
      }),
    })
    .strict(),
  run: async (args) => {
    const workspaces = await listWorkspaces({
      order: args.order,
      limit: args.limit,
      profile: args.profile,
    });
    logger.out(workspaces, {
      display: {
        name: workspaceNameTransformer,
        folderName: null,
        organizationId: null,
        folderId: null,
        updatedAt: null,
      },
    });
  },
});
