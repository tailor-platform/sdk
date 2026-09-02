import { arg } from "politty";
import { z } from "zod";
import { organizationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { parseOptions } from "#/cli/shared/parse-options";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { folderInfo, type FolderInfo } from "../transform";

// strip unknown keys
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
  const validated = parseOptions(createFolderOptionsSchema, options);

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const response = await client.createOrganizationFolder({
    organizationId: validated.organizationId,
    parentFolderId: validated.parentFolderId ?? "",
    folderName: validated.name,
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
