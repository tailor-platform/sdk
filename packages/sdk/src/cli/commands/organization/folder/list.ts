import { arg } from "politty";
import { z } from "zod";
import { orderArg, organizationArgs, paginationArgs, toPageDirection } from "#/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import { folderListInfo, type FolderListInfo } from "../transform";

const listFoldersOptionsSchema = /* strip unknown keys */ z.object({
  organizationId: z.uuid({ message: "organization-id must be a valid UUID" }),
  parentFolderId: z.string().optional(),
  order: orderArg.optional(),
  limit: z.number().int().nonnegative().optional(),
});

export type ListFoldersOptions = z.input<typeof listFoldersOptionsSchema>;

/**
 * List folders in an organization.
 * @param options - Folder listing options
 * @returns List of folders
 */
export async function listFolders(options: ListFoldersOptions): Promise<FolderListInfo[]> {
  const result = listFoldersOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], "Zod returned no issues").message);
  }

  const { organizationId, parentFolderId, order, limit } = result.data;

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const pageDirection = toPageDirection(order);
  const folders = await fetchPaged(
    async (pageToken, pageSize) => {
      const response = await client.listOrganizationFolders({
        organizationId,
        ...(parentFolderId ? { parentFolderId } : {}),
        pageToken,
        pageSize,
        pageDirection,
      });
      return [response.folders, response.nextPageToken];
    },
    { limit },
  );

  return folders.map(folderListInfo);
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List folders in an organization.",
  args: z.strictObject({
    ...organizationArgs,
    "parent-folder-id": arg(z.string().optional(), {
      description: "Parent folder ID to list children of",
    }),
    ...paginationArgs(),
  }),
  run: async (args) => {
    const folders = await listFolders({
      organizationId: args["organization-id"],
      parentFolderId: args["parent-folder-id"],
      order: args.order,
      limit: args.limit,
    });
    logger.out(folders, { display: { updatedAt: null } });
  },
});
