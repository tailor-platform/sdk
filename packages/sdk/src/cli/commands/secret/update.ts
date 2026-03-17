import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { secretValueArgs } from "./args";
import { managedVaultGuard } from "./managed-vault-guard";

export const updateSecretCommand = defineAppCommand({
  name: "update",
  description: "Update a secret in a vault.",
  args: z
    .object({
      ...workspaceArgs,
      ...secretValueArgs,
      ...confirmationArgs,
    })
    .strict(),
  run: async (args) => {
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const shouldProceed = await managedVaultGuard({
      client,
      workspaceId,
      vaultName: args["vault-name"],
      yes: args.yes,
    });
    if (!shouldProceed) return;

    try {
      await client.updateSecretManagerSecret({
        workspaceId,
        secretmanagerVaultName: args["vault-name"],
        secretmanagerSecretName: args.name,
        secretmanagerSecretValue: args.value,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw new Error(`Secret "${args.name}" not found in vault "${args["vault-name"]}".`);
      }
      throw error;
    }

    logger.success(`Secret: ${args.name} updated in vault: ${args["vault-name"]}`);
  },
});
