import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs, setupCommonArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { secretIdentifyArgs } from "./args";

export const deleteSecretCommand = defineAppCommand({
  name: "delete",
  description: "Delete a secret in a vault.",
  args: z
    .object({
      ...workspaceArgs,
      ...secretIdentifyArgs,
      ...confirmationArgs,
    })
    .strict(),
  run: async (args) => {
    setupCommonArgs(args);
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    if (!args.yes) {
      const confirmation = await logger.prompt(
        `Enter the secret name to confirm deletion ("${args.name}"): `,
        { type: "text" },
      );

      if (confirmation !== args.name) {
        logger.info("Secret deletion cancelled.");
        return;
      }
    }

    try {
      await client.deleteSecretManagerSecret({
        workspaceId,
        secretmanagerVaultName: args["vault-name"],
        secretmanagerSecretName: args.name,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw new Error(`Secret "${args.name}" not found in vault "${args["vault-name"]}".`);
      }
      throw error;
    }

    logger.success(`Secret: ${args.name} deleted from vault: ${args["vault-name"]}`);
  },
});
