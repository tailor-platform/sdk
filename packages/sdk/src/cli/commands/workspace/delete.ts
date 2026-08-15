import { arg } from "@politty/valibot";
import * as v from "valibot";
import { confirmationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { resolveWorkspaceFolderName, workspaceDisplayName } from "./transform";

// strip unknown keys
const deleteWorkspaceOptionsSchema = v.object({
  workspaceId: v.pipe(v.string(), v.uuid("workspace-id must be a valid UUID")),
});

export type DeleteWorkspaceOptions = v.InferInput<typeof deleteWorkspaceOptionsSchema>;

async function loadOptions(options: DeleteWorkspaceOptions) {
  // Validate options with zod schema
  const result = v.safeParse(deleteWorkspaceOptionsSchema, options);
  if (!result.success) {
    throw new Error(result.issues[0].message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  return {
    client,
    workspaceId: result.output.workspaceId,
  };
}

/**
 * Delete a workspace by ID.
 * @param options - Workspace deletion options
 * @returns Promise that resolves when deletion completes
 */
export async function deleteWorkspace(options: DeleteWorkspaceOptions): Promise<void> {
  // Load and validate options
  const { client, workspaceId } = await loadOptions(options);

  // Delete workspace
  await client.deleteWorkspace({
    workspaceId,
  });
}

export const deleteCommand = defineAppCommand({
  name: "delete",
  description: "Delete a Tailor Platform workspace.",
  args: v.strictObject({
    "workspace-id": arg(v.string(), {
      alias: "w",
      description: "Workspace ID",
    }),
    ...confirmationArgs,
  }),
  run: async (args) => {
    await assertWritable();
    // Load and validate options
    const { client, workspaceId } = await loadOptions({
      workspaceId: args["workspace-id"],
    });

    // Check if workspace exists
    let workspace;
    try {
      workspace = await client.getWorkspace({
        workspaceId,
      });
    } catch {
      throw new Error(`Workspace "${workspaceId}" not found.`);
    }

    const workspaceResource = workspace.workspace;
    const workspaceName = workspaceResource?.name ?? workspaceId;
    const folderName = workspaceResource
      ? await resolveWorkspaceFolderName(client, workspaceResource)
      : "";
    const displayName = workspaceDisplayName({ name: workspaceName, folderName });

    // Confirm deletion if not forced
    if (!args.yes) {
      const confirmation = await prompt.text({
        message: `Enter the workspace name to confirm deletion (${displayName}):`,
      });
      if (confirmation !== workspaceName && confirmation !== displayName) {
        logger.info("Workspace deletion cancelled.");
        return;
      }
    }

    // Delete workspace
    await client.deleteWorkspace({
      workspaceId,
    });

    // Remove profiles associated with the deleted workspace
    const pfConfig = await readPlatformConfig();
    const profilesToDelete = Object.entries(pfConfig.profiles).filter(
      ([, profile]) => profile.workspace_id === workspaceId,
    );
    if (profilesToDelete.length > 0) {
      for (const [profileName] of profilesToDelete) {
        delete pfConfig.profiles[profileName];
      }
      writePlatformConfig(pfConfig);
    }

    // Show success message
    if (profilesToDelete.length > 0) {
      logger.success(
        `Workspace "${displayName}" and ${profilesToDelete.length} associated profile(s) deleted successfully.`,
      );
    } else {
      logger.success(`Workspace "${displayName}" deleted successfully.`);
    }
  },
});
