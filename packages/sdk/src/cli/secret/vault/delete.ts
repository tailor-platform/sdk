import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, confirmationArgs, withCommonArgs, workspaceArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { logger } from "../../utils/logger";
import { nameArgs } from "./args";

export const deleteCommand = defineCommand({
  name: "delete",
  description: "Delete a Secret Manager vault",
  args: z.object({
    ...commonArgs,
    ...workspaceArgs,
    ...nameArgs,
    ...confirmationArgs,
  }),
  run: withCommonArgs(async (args) => {
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
  }),
});
