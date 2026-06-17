import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "#src/cli/shared/args";
import { initOperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import { prompt } from "#src/cli/shared/prompt";
import { assertWritable } from "#src/cli/shared/readonly-guard";
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
