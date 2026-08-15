import * as v from "valibot";
import { folderArgs, organizationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { folderInfo, type FolderInfo } from "../transform";

// strip unknown keys
const getFolderOptionsSchema = v.object({
  organizationId: v.pipe(v.string(), v.uuid("organization-id must be a valid UUID")),
  folderId: v.pipe(v.string(), v.uuid("folder-id must be a valid UUID")),
});

export type GetFolderOptions = v.InferInput<typeof getFolderOptionsSchema>;

/**
 * Get detailed information about a folder.
 * @param options - Folder get options
 * @returns Folder details
 */
export async function getFolder(options: GetFolderOptions): Promise<FolderInfo> {
  const result = v.safeParse(getFolderOptionsSchema, options);
  if (!result.success) {
    throw new Error(result.issues[0].message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const response = await client.getOrganizationFolder({
    organizationId: result.output.organizationId,
    folderId: result.output.folderId,
  });

  if (!response.folder) {
    throw new Error(`Folder "${result.output.folderId}" not found.`);
  }

  return folderInfo(response.folder);
}

export const getCommand = defineAppCommand({
  name: "get",
  description: "Show detailed information about a folder.",
  args: v.strictObject({
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
