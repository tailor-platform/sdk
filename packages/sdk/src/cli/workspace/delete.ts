import { defineCommand } from "citty";
import { consola } from "consola";
import { validate as validateUuid } from "uuid";
import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken } from "../context";

export interface DeleteWorkspaceOptions {
  workspaceId: string;
}

async function loadOptions(options: DeleteWorkspaceOptions) {
  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);
  if (!validateUuid(options.workspaceId)) {
    throw new Error(
      `Workspace ID "${options.workspaceId}" is not a valid UUID.`,
    );
  }
  return {
    client,
    workspaceId: options.workspaceId,
  };
}

export async function deleteWorkspace(
  options: DeleteWorkspaceOptions,
): Promise<void> {
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
      const confirmation = await consola.prompt(
        `Enter the workspace name to confirm deletion (${workspace.workspace?.name}):`,
        {
          type: "text",
        },
      );
      if (confirmation !== workspace.workspace?.name) {
        consola.info("Workspace deletion cancelled.");
        return;
      }
    }

    // Delete workspace
    await client.deleteWorkspace({
      workspaceId,
    });

    // Show success message
    consola.success(
      `Workspace "${args["workspace-id"]}" deleted successfully.`,
    );
  }),
});
