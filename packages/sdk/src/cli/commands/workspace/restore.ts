import { arg } from "politty";
import { z } from "zod";
import { confirmationArgs } from "#src/cli/shared/args";
import { initOperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadAccessToken } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import { prompt } from "#src/cli/shared/prompt";
import { assertWritable } from "#src/cli/shared/readonly-guard";
import { assertDefined } from "#src/utils/assert";

const restoreWorkspaceOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }),
});

export type RestoreWorkspaceOptions = z.input<typeof restoreWorkspaceOptionsSchema>;

async function loadOptions(options: RestoreWorkspaceOptions) {
  const result = restoreWorkspaceOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], "Zod returned no issues").message);
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

export const restoreCommand = defineAppCommand({
  name: "restore",
  description: "Restore a deleted workspace",
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
    const { client, workspaceId } = await loadOptions({
      workspaceId: args["workspace-id"],
    });

    if (!args.yes) {
      const confirmation = await prompt.text({
        message: `Are you sure you want to restore workspace "${workspaceId}"? (yes/no):`,
      });
      if (confirmation !== "yes") {
        logger.info("Workspace restoration cancelled.");
        return;
      }
    }

    await client.restoreWorkspace({
      workspaceId,
    });

    logger.success(`Workspace "${workspaceId}" restored successfully.`);
  },
});
