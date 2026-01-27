import { defineCommand } from "citty";
import { z } from "zod";
import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken } from "../context";
import { logger } from "../utils/logger";

const restoreWorkspaceOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }),
});

export type RestoreWorkspaceOptions = z.input<typeof restoreWorkspaceOptionsSchema>;

async function loadOptions(options: RestoreWorkspaceOptions) {
  const result = restoreWorkspaceOptionsSchema.safeParse(options);
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
 * Restore a deleted workspace by ID.
 * @param options - Workspace restore options
 * @returns Promise that resolves when restoration completes
 */
export async function restoreWorkspace(options: RestoreWorkspaceOptions): Promise<void> {
  const { client, workspaceId } = await loadOptions(options);

  await client.restoreWorkspace({
    workspaceId,
  });
}

export const restoreCommand = defineCommand({
  meta: {
    name: "restore",
    description: "Restore a deleted workspace",
  },
  args: {
    ...commonArgs,
    "workspace-id": {
      type: "string",
      description: "Workspace ID to restore",
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
    const { client, workspaceId } = await loadOptions({
      workspaceId: args["workspace-id"],
    });

    if (!args.yes) {
      const confirmation = await logger.prompt(
        `Are you sure you want to restore workspace "${workspaceId}"? (yes/no):`,
        {
          type: "text",
        },
      );
      if (confirmation !== "yes") {
        logger.info("Workspace restoration cancelled.");
        return;
      }
    }

    await client.restoreWorkspace({
      workspaceId,
    });

    logger.success(`Workspace "${workspaceId}" restored successfully.`);
  }),
});
