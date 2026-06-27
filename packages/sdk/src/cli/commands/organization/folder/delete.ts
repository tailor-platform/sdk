import { z } from "zod";
import { confirmationArgs, folderArgs, organizationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { assertDefined } from "#/utils/assert";

const deleteFolderOptionsSchema = z.strictObject({
  organizationId: z.uuid({ message: "organization-id must be a valid UUID" }),
  folderId: z.uuid({ message: "folder-id must be a valid UUID" }),
});

export type DeleteFolderOptions = z.input<typeof deleteFolderOptionsSchema>;

/**
 * Delete a folder from an organization.
 * @param options - Folder deletion options
 * @returns Promise that resolves when deletion completes
 */
export async function deleteFolder(options: DeleteFolderOptions): Promise<void> {
  const result = deleteFolderOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], "Zod returned no issues").message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  await client.deleteOrganizationFolder({
    organizationId: result.data.organizationId,
    folderId: result.data.folderId,
  });
}

export const deleteCommand = defineAppCommand({
  name: "delete",
  description: "Delete a folder from an organization.",
  args: z.strictObject({
    ...organizationArgs,
    ...folderArgs,
    ...confirmationArgs,
  }),
  run: async (args) => {
    await assertWritable();
    const accessToken = await loadAccessToken();
    const client = await initOperatorClient(accessToken);

    // Check if folder exists and get its name
    let folderName: string | undefined;
    try {
      const response = await client.getOrganizationFolder({
        organizationId: args["organization-id"],
        folderId: args["folder-id"],
      });
      folderName = response.folder?.name;
    } catch {
      throw new Error(`Folder "${args["folder-id"]}" not found.`);
    }

    // Confirm deletion if not forced
    if (!args.yes) {
      const confirmed = await prompt.confirm({
        message: `Are you sure you want to delete folder "${folderName}"?`,
      });
      if (!confirmed) {
        logger.info("Folder deletion cancelled.");
        return;
      }
    }

    await client.deleteOrganizationFolder({
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
    });

    logger.success(`Folder "${folderName}" deleted successfully.`);
  },
});
