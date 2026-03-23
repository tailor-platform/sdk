import { arg } from "politty";
import { z } from "zod";
import { organizationArgs, positiveIntArg } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { folderListInfo, type FolderListInfo } from "../transform";

const listFoldersOptionsSchema = z.object({
  organizationId: z.uuid({ message: "organization-id must be a valid UUID" }),
  parentFolderId: z.string().optional(),
  limit: z.number().int().positive().optional(),
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
    throw new Error(result.error.issues[0].message);
  }

  const { organizationId, parentFolderId, limit } = result.data;
  const hasLimit = limit !== undefined;

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const results: FolderListInfo[] = [];
  let pageToken = "";

  while (true) {
    if (hasLimit && results.length >= limit!) {
      break;
    }

    const remaining = hasLimit ? limit! - results.length : undefined;
    const pageSize = remaining !== undefined && remaining > 0 ? remaining : undefined;

    const response = await client.listOrganizationFolders({
      organizationId,
      ...(parentFolderId ? { parentFolderId } : {}),
      pageToken,
      ...(pageSize !== undefined ? { pageSize } : {}),
    });

    const mapped = response.folders.map(folderListInfo);

    if (remaining !== undefined && mapped.length > remaining) {
      results.push(...mapped.slice(0, remaining));
    } else {
      results.push(...mapped);
    }

    if (!response.nextPageToken) {
      break;
    }
    pageToken = response.nextPageToken;
  }

  return results;
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List folders in an organization.",
  args: z
    .object({
      ...organizationArgs,
      "parent-folder-id": arg(z.string().optional(), {
        description: "Parent folder ID to list children of",
      }),
      limit: arg(positiveIntArg.optional(), {
        alias: "l",
        description: "Maximum number of folders to list",
      }),
    })
    .strict(),
  run: async (args) => {
    const folders = await listFolders({
      organizationId: args["organization-id"],
      parentFolderId: args["parent-folder-id"],
      limit: args.limit,
    });
    logger.out(folders, { display: { updatedAt: null } });
  },
});
