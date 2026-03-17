import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { prompt } from "@/cli/shared/prompt";
import { secretValueArgs } from "./args";
import { checkVaultManaged } from "./check-vault-managed";

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

    const isManaged = await checkVaultManaged({
      client,
      workspaceId,
      vaultName: args["vault-name"],
    });
    if (isManaged && !args.yes) {
      const confirmed = await prompt.confirm({
        message: "Do you want to proceed?",
        default: false,
      });
      if (!confirmed) return;
    }

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
