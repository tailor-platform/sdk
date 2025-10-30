import { defineCommand } from "citty";
import { consola } from "consola";
import { validate as uuidValidate } from "uuid";
import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken } from "../context";

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
    // Validate args
    if (!uuidValidate(args["workspace-id"])) {
      throw new Error(
        `Workspace ID "${args["workspace-id"]}" is not a valid UUID.`,
      );
    }

    const accessToken = await loadAccessToken();
    const client = await initOperatorClient(accessToken);

    // Check if workspace exists
    let workspace;
    try {
      workspace = await client.getWorkspace({
        workspaceId: args["workspace-id"],
      });
    } catch {
      throw new Error(`Workspace "${args["workspace-id"]}" not found.`);
    }

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

    await client.deleteWorkspace({
      workspaceId: args["workspace-id"],
    });

    consola.success(
      `Workspace "${args["workspace-id"]}" deleted successfully.`,
    );
  }),
});
