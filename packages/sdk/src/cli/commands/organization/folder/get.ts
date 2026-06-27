import { z } from "zod";
import { folderArgs, organizationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import { folderInfo, type FolderInfo } from "../transform";

const getFolderOptionsSchema = z.strictObject({
  organizationId: z.uuid({ message: "organization-id must be a valid UUID" }),
  folderId: z.uuid({ message: "folder-id must be a valid UUID" }),
});

export type GetFolderOptions = z.input<typeof getFolderOptionsSchema>;

/**
 * Get detailed information about a folder.
 * @param options - Folder get options
 * @returns Folder details
 */
export async function getFolder(options: GetFolderOptions): Promise<FolderInfo> {
  const result = getFolderOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], "Zod returned no issues").message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const response = await client.getOrganizationFolder({
    organizationId: result.data.organizationId,
    folderId: result.data.folderId,
  });

  if (!response.folder) {
    throw new Error(`Folder "${result.data.folderId}" not found.`);
  }

  return folderInfo(response.folder);
}

export const getCommand = defineAppCommand({
  name: "get",
  description: "Show detailed information about a folder.",
  args: z.strictObject({
    ...organizationArgs,
    ...folderArgs,
  }),
  run: async (args) => {
    const folder = await getFolder({
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
    });

    const formattedFolder = args.json
      ? folder
      : {
          ...folder,
          createdAt: humanizeRelativeTime(folder.createdAt),
          updatedAt: humanizeRelativeTime(folder.updatedAt),
        };

    logger.out(formattedFolder);
  },
});
