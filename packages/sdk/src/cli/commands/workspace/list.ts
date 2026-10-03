import { arg } from "@politty/zod";
import { z } from "zod";
import { type Order, paginationArgs, toPageDirection } from "#/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadPlatformClientConfig } from "#/cli/shared/context";
import { fetchWithinLimit, reportTruncation, type LimitedItems } from "#/cli/shared/limit";
import { logger } from "#/cli/shared/logger";
import { profileNameSchema } from "#/cli/shared/profile-name";
import { fetchReportedExpiries, type ReportedExpiry } from "./expiry";
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

/** A listed workspace, plus the prune expiry it records. */
export type WorkspaceInfoWithExpiry = WorkspaceInfo & { expiresAt: ReportedExpiry };

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
 * List workspaces along with the prune expiry each one records, and whether `limit` left any out.
 *
 * The expiries are read per workspace, so this stays out of the plain listing
 * path that deploy uses to pick a workspace.
 * @param options - Workspace listing options
 * @returns Workspaces, each carrying its recorded expiry, and whether more exist beyond the limit
 */
export async function listWorkspacesWithExpiry(
  options?: ListWorkspacesOptions,
): Promise<LimitedItems<WorkspaceInfoWithExpiry>> {
  const profile = profileNameSchema.optional().parse(options?.profile);
  const accessToken = await loadAccessToken({ profile });
  const platformConfig = await loadPlatformClientConfig({ profile });
  const client = await initOperatorClient(accessToken, platformConfig);
  const listed = await fetchWithinLimit(options?.limit, (limit) =>
    fetchWorkspaces(client, { ...options, limit }),
  );
  const workspaces = await workspaceInfosWithFolderNames(client, listed.items);
  const expiries = await fetchReportedExpiries(
    client,
    workspaces.map(({ id }) => id),
    new Date(),
  );
  return {
    items: workspaces.map((workspace, index) => {
      const expiresAt = expiries[index];
      return { ...workspace, expiresAt: expiresAt === undefined ? "unavailable" : expiresAt };
    }),
    truncated: listed.truncated,
  };
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
  return workspaceInfosWithFolderNames(client, await fetchWorkspaces(client, options));
}

async function fetchWorkspaces(
  client: Parameters<typeof workspaceInfosWithFolderNames>[0],
  options?: ListWorkspacesOptions,
) {
  const pageDirection = toPageDirection(options?.order);
  return fetchPaged(
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
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all Tailor Platform workspaces.",
  args: z.strictObject({
    ...paginationArgs(),
    profile: arg(profileNameSchema.optional(), {
      description: "Workspace profile used for authentication and Platform selection",
      env: "TAILOR_PLATFORM_PROFILE",
    }),
  }),
  run: async (args) => {
    const workspaces = await listWorkspacesWithExpiry({
      order: args.order,
      limit: args.limit,
      profile: args.profile,
    });
    logger.out(workspaces.items, {
      display: {
        name: workspaceNameTransformer,
        folderName: null,
        organizationId: null,
        folderId: null,
        updatedAt: null,
      },
    });
    await reportTruncation(workspaces, args.limit);
  },
});
