import { defineCommand } from "citty";
import { z } from "zod";
import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken } from "../context";
import { logger } from "../utils/logger";

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

export async function deleteWorkspace(options: DeleteWorkspaceOptions): Promise<void> {
  // Load and validate options
  const { client, workspaceId } = await loadOptions(options);

  // Delete workspace
  await client.deleteWorkspace({
    workspaceId,
  });
}

export const deleteCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete workspace",
  },
  args: {
    ...commonArgs,
    "workspace-id": {
      type: "string",
      description: "Workspace ID",
      required: true,
      alias: "w",
    },
    yes: {
      type: "boolean",
      description: "Skip confirmation prompt",
      alias: "y",
      default: false,
    },
  },
  run: withCommonArgs(async (args) => {
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

    // Confirm deletion if not forced
    if (!args.yes) {
      const confirmation = await logger.prompt(
        `Enter the workspace name to confirm deletion (${workspace.workspace?.name}):`,
        {
          type: "text",
        },
      );
      if (confirmation !== workspace.workspace?.name) {
        logger.info("Workspace deletion cancelled.");
        return;
      }
    }

    // Delete workspace
    await client.deleteWorkspace({
      workspaceId,
    });

    // Show success message
    logger.success(`Workspace "${args["workspace-id"]}" deleted successfully.`);
  }),
});
