import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "#src/cli/shared/args";
import { initOperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import { prompt } from "#src/cli/shared/prompt";
import { assertWritable } from "#src/cli/shared/readonly-guard";
import { secretIdentifyArgs } from "./args";
import { checkVaultManaged, releaseVaultOwnership } from "./check-vault-managed";

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
    const managed = await checkVaultManaged({ client, workspaceId, vaultName: args["vault-name"] });

    if (!args.yes) {
      const confirmation = await prompt.text({
        message: `Enter the secret name to confirm deletion ("${args.name}"):`,
      });

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
        throw new Error(`Secret "${args.name}" not found in vault "${args["vault-name"]}".`, {
          cause: error,
        });
      }
      throw error;
    }

    if (managed.isManaged) {
      await releaseVaultOwnership({ client, ...managed });
    }

    logger.success(`Secret: ${args.name} deleted from vault: ${args["vault-name"]}`);
  },
});
