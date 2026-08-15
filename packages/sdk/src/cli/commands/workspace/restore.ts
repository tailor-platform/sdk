import { arg } from "@politty/valibot";
import * as v from "valibot";
import { confirmationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";

// strip unknown keys
const restoreWorkspaceOptionsSchema = v.object({
  workspaceId: v.pipe(v.string(), v.uuid("workspace-id must be a valid UUID")),
});

export type RestoreWorkspaceOptions = v.InferInput<typeof restoreWorkspaceOptionsSchema>;

async function loadOptions(options: RestoreWorkspaceOptions) {
  const result = v.safeParse(restoreWorkspaceOptionsSchema, options);
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
  args: v.strictObject({
    "workspace-id": arg(v.string(), {
      alias: "w",
      description: "Workspace ID",
    }),
    ...confirmationArgs,
  }),
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
