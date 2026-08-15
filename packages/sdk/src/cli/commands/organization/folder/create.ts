import { arg } from "@politty/valibot";
import * as v from "valibot";
import { organizationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { folderInfo, type FolderInfo } from "../transform";

// strip unknown keys
const createFolderOptionsSchema = v.object({
  organizationId: v.pipe(v.string(), v.uuid("organization-id must be a valid UUID")),
  parentFolderId: v.optional(v.string()),
  name: v.pipe(v.string(), v.minLength(1, "Name must not be empty")),
});

export type CreateFolderOptions = v.InferInput<typeof createFolderOptionsSchema>;

/**
 * Create a new folder in an organization.
 * @param options - Folder creation options
 * @returns Created folder details
 */
export async function createFolder(options: CreateFolderOptions): Promise<FolderInfo> {
  const result = v.safeParse(createFolderOptionsSchema, options);
  if (!result.success) {
    throw new Error(result.issues[0].message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const response = await client.createOrganizationFolder({
    organizationId: result.output.organizationId,
    parentFolderId: result.output.parentFolderId ?? "",
    folderName: result.output.name,
  });

  if (!response.folder) {
    throw new Error("Failed to create folder.");
  }

  return folderInfo(response.folder);
}

export const createCommand = defineAppCommand({
  name: "create",
  description: "Create a new folder in an organization.",
  args: v.strictObject({
    ...organizationArgs,
    "parent-folder-id": arg(v.optional(v.string()), {
      description: "Parent folder ID",
    }),
    name: arg(v.string(), {
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
