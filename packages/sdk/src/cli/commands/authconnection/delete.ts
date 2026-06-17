import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "#src/cli/shared/args";
import { initOperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import { prompt } from "#src/cli/shared/prompt";
import { assertWritable } from "#src/cli/shared/readonly-guard";
import { connectionNameArgs } from "./args";

export const deleteAuthConnectionCommand = defineAppCommand({
  name: "delete",
  description: "Delete an auth connection entirely.",
  args: z
    .object({
      ...workspaceArgs,
      ...connectionNameArgs,
      ...confirmationArgs,
    })
    .strict(),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const accessToken = await loadAccessToken({
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    if (!args.yes) {
      const confirmation = await prompt.text({
        message: `Enter the connection name to confirm deletion ("${args.name}"):`,
      });

      if (confirmation !== args.name) {
        logger.info("Auth connection deletion cancelled.");
        return;
      }
    }

    try {
      await client.deleteAuthConnection({ workspaceId, connectionName: args.name });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw new Error(`Auth connection "${args.name}" not found.`, { cause: error });
      }
      throw error;
    }

    logger.success(`Auth connection "${args.name}" deleted.`);
  },
});
