import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { connectionNameArgs } from "./args";

export const revokeAuthConnectionCommand = defineAppCommand({
  name: "revoke",
  description:
    "Revoke an auth connection's tokens (keeps the connection; use 'delete' to remove it).",
  notes:
    "Revoke invalidates the connection's active session and tokens but keeps the connection and its stored credentials, so it can be re-authorized later. Use `delete` to remove the connection entirely.",
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
        message: `Enter the connection name to confirm revocation ("${args.name}"):`,
      });

      if (confirmation !== args.name) {
        logger.info("Auth connection revocation cancelled.");
        return;
      }
    }

    try {
      await client.revokeAuthConnection({
        workspaceId,
        connectionName: args.name,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw new Error(`Auth connection "${args.name}" not found.`, { cause: error });
      }
      throw error;
    }

    logger.success(`Auth connection "${args.name}" revoked.`);
  },
});
