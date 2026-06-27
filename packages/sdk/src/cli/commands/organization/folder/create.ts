import { arg } from "politty";
import { z } from "zod";
import { organizationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { assertDefined } from "#/utils/assert";
import { folderInfo, type FolderInfo } from "../transform";

const createFolderOptionsSchema = z.object({
  organizationId: z.uuid({ message: "organization-id must be a valid UUID" }),
  parentFolderId: z.string().optional(),
  name: z.string().min(1, "Name must not be empty"),
});

export type CreateFolderOptions = z.input<typeof createFolderOptionsSchema>;

/**
 * Create a new folder in an organization.
 * @param options - Folder creation options
 * @returns Created folder details
 */
export async function createFolder(options: CreateFolderOptions): Promise<FolderInfo> {
  const result = createFolderOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], "Zod returned no issues").message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const response = await client.createOrganizationFolder({
    organizationId: result.data.organizationId,
    parentFolderId: result.data.parentFolderId ?? "",
    folderName: result.data.name,
  });

  if (!response.folder) {
    throw new Error("Failed to create folder.");
  }

  return folderInfo(response.folder);
}

export const createCommand = defineAppCommand({
  name: "create",
  description: "Create a new folder in an organization.",
  args: z.strictObject({
    ...organizationArgs,
    "parent-folder-id": arg(z.string().optional(), {
      description: "Parent folder ID",
    }),
    name: arg(z.string(), {
      alias: "n",
      description: "Folder name",
    }),
  }),
  run: async (args) => {
    await assertWritable();
    const folder = await createFolder({
      organizationId: args["organization-id"],
      parentFolderId: args["parent-folder-id"],
      name: args.name,
    });

    if (!args.json) {
      logger.success(`Folder "${folder.name}" created successfully.`);
    }

    logger.out(folder);
  },
});
