import { arg } from "politty";
import { z } from "zod";
import { folderArgs, organizationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { assertDefined } from "#/utils/assert";
import { folderInfo, type FolderInfo } from "../transform";

const updateFolderOptionsSchema = z.strictObject({
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
  const result = updateFolderOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], "Zod returned no issues").message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const response = await client.updateOrganizationFolder({
    organizationId: result.data.organizationId,
    folderId: result.data.folderId,
    folderName: result.data.name,
  });

  if (!response.folder) {
    throw new Error(`Failed to update folder "${result.data.folderId}".`);
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
