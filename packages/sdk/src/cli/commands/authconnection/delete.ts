import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { printMutationResult } from "#/cli/shared/mutation-result";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { connectionNameArgs } from "./args";

export const deleteAuthConnectionCommand = defineAppCommand({
  name: "delete",
  description: "Delete an auth connection entirely.",
  args: z.strictObject({
    ...workspaceArgs,
    ...connectionNameArgs,
    ...confirmationArgs,
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });

    if (!args.yes) {
      const confirmation = await prompt.text({
        message: `Enter the connection name to confirm deletion ("${args.name}"):`,
      });

      if (confirmation !== args.name) {
        throw CLIError({
          code: "AUTH_CONNECTION_DELETION_CANCELLED",
          message: "Auth connection deletion cancelled: the entered name did not match.",
          suggestion:
            "Run the command again and enter the name exactly as shown, or pass --yes to skip the confirmation.",
        });
      }
    }

    try {
      await client.deleteAuthConnection({ workspaceId, connectionName: args.name });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw CLIError({
          code: "AUTH_CONNECTION_NOT_FOUND",
          message: `Auth connection "${args.name}" not found.`,
          cause: error,
        });
      }
      throw error;
    }

    logger.success(`Auth connection "${args.name}" deleted.`);
    printMutationResult({ changed: true, workspaceId, name: args.name });
  },
});
