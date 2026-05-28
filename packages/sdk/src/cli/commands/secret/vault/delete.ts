import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { prompt } from "@/cli/shared/prompt";
import { assertWritable } from "@/cli/shared/readonly-guard";
import { checkVaultManaged } from "../check-vault-managed";
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
    await assertWritable({ profile: args.profile });
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    // No additional confirmation for managed vaults — the name-typing confirmation below is a stronger guard.
    const managed = await checkVaultManaged({ client, workspaceId, vaultName: args.name });

    if (!args.yes) {
      const confirmation = await prompt.text({
        message: `Enter the vault name to confirm deletion ("${args.name}"):`,
      });
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
        throw new Error(`Vault "${args.name}" not found.`, { cause: error });
      }
      throw error;
    }

    if (managed.isManaged) {
      logger.info(
        "Remove this vault from defineSecretManager() in your config to prevent the next apply from re-creating it.",
      );
    }

    logger.success(`Vault: ${args.name} deleted`);
  },
});
