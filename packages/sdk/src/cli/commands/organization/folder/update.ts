import { arg } from "@politty/valibot";
import * as v from "valibot";
import { folderArgs, organizationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { assertDefined } from "#/utils/assert";
import { folderInfo, type FolderInfo } from "../transform";

// strip unknown keys
const updateFolderOptionsSchema = v.object({
  organizationId: v.pipe(v.string(), v.uuid("organization-id must be a valid UUID")),
  folderId: v.pipe(v.string(), v.uuid("folder-id must be a valid UUID")),
  name: v.pipe(v.string(), v.minLength(1, "Name must not be empty")),
});

export type UpdateFolderOptions = v.InferInput<typeof updateFolderOptionsSchema>;

/**
 * Update a folder's name.
 * @param options - Folder update options
 * @returns Updated folder details
 */
export async function updateFolder(options: UpdateFolderOptions): Promise<FolderInfo> {
  const result = v.safeParse(updateFolderOptionsSchema, options);
  if (!result.success) {
    throw new Error(assertDefined(result.issues[0], "Valibot returned no issues").message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const response = await client.updateOrganizationFolder({
    organizationId: result.output.organizationId,
    folderId: result.output.folderId,
    folderName: result.output.name,
  });

  if (!response.folder) {
    throw new Error(`Failed to update folder "${result.output.folderId}".`);
  }

  return folderInfo(response.folder);
}

export const updateCommand = defineAppCommand({
  name: "update",
  description: "Update a folder's name.",
  args: v.strictObject({
    ...organizationArgs,
    ...folderArgs,
    name: arg(v.string(), {
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
