import { arg } from "politty";
import { z } from "zod";
import { confirmationArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, readPlatformConfig, writePlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { prompt } from "@/cli/shared/prompt";
import { assertWritable } from "@/cli/shared/readonly-guard";
import { resolveWorkspaceFolderName, workspaceDisplayName } from "./transform";

const deleteWorkspaceOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }),
});

export type DeleteWorkspaceOptions = z.input<typeof deleteWorkspaceOptionsSchema>;

async function loadOptions(options: DeleteWorkspaceOptions) {
  // Validate options with zod schema
  const result = deleteWorkspaceOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  return {
    client,
    workspaceId: result.data.workspaceId,
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
  args: z
    .object({
      "workspace-id": arg(z.string(), {
        alias: "w",
        description: "Workspace ID",
      }),
      ...confirmationArgs,
    })
    .strict(),
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
      ([, profile]) => profile?.workspace_id === workspaceId,
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
