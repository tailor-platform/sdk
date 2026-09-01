import { arg } from "politty";
import { z } from "zod";
import { folderArgs, organizationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { parseOptions } from "#/cli/shared/parse-options";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { folderInfo, type FolderInfo } from "../transform";

// strip unknown keys
const updateFolderOptionsSchema = z.object({
  organizationId: z.uuid({ message: "organization-id must be a valid UUID" }),
  folderId: z.uuid({ message: "folder-id must be a valid UUID" }),
  name: z.string().min(1, "Name must not be empty"),
});

export type UpdateFolderOptions = z.input<typeof updateFolderOptionsSchema>;

/**
 * Update a folder's name.
 * @param options - Folder update options
 * @returns Updated folder details
 */
export async function updateFolder(options: UpdateFolderOptions): Promise<FolderInfo> {
  const validated = parseOptions(updateFolderOptionsSchema, options);

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const response = await client.updateOrganizationFolder({
    organizationId: validated.organizationId,
    folderId: validated.folderId,
    folderName: validated.name,
  });

  if (!response.folder) {
    throw new Error(`Failed to update folder "${validated.folderId}".`);
  }

  return folderInfo(response.folder);
}

export const updateCommand = defineAppCommand({
  name: "update",
  description: "Update a folder's name.",
  args: z.strictObject({
    ...organizationArgs,
    ...folderArgs,
    name: arg(z.string(), {
      alias: "n",
      description: "New folder name",
    }),
  }),
  run: async (args) => {
    await assertWritable();
    const folder = await updateFolder({
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
      name: args.name,
    });

    if (!args.json) {
      logger.success(`Folder "${folder.name}" updated successfully.`);
    }

    logger.out(folder);
  },
});
