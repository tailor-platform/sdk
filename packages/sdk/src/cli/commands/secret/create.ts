import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { secretValueArgs } from "./args";
import { managedVaultGuard } from "./managed-vault-guard";

export const createSecretCommand = defineAppCommand({
  name: "create",
  description: "Create a secret in a vault.",
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
      await client.createSecretManagerSecret({
        workspaceId,
        secretmanagerVaultName: args["vault-name"],
        secretmanagerSecretName: args.name,
        secretmanagerSecretValue: args.value,
      });
    } catch (error) {
      if (error instanceof ConnectError) {
        if (error.code === Code.NotFound) {
          throw new Error(`Vault "${args["vault-name"]}" not found.`);
        }
        if (error.code === Code.AlreadyExists) {
          throw new Error(`Secret "${args.name}" already exists.`);
        }
      }
      throw error;
    }

    logger.success(`Secret: ${args.name} created in vault: ${args["vault-name"]}`);
  },
});
