import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs, setupCommonArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { nameArgs } from "./args";

export const deleteCommand = defineAppCommand({
  name: "delete",
  description: "Delete a Secret Manager vault.",
  args: z
    .object({
      ...workspaceArgs,
      ...nameArgs,
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
        `Enter the vault name to confirm deletion ("${args.name}"): `,
        { type: "text" },
      );
      if (confirmation !== args.name) {
        logger.info("Vault deletion cancelled.");
        return;
      }
    }

    try {
      await client.deleteSecretManagerVault({
        workspaceId,
        secretmanagerVaultName: args.name,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw new Error(`Vault "${args.name}" not found.`);
      }
      throw error;
    }

    logger.success(`Vault: ${args.name} deleted`);
  },
});
