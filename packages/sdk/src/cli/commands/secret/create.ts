import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "#src/cli/shared/args";
import { initOperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import { prompt } from "#src/cli/shared/prompt";
import { assertWritable } from "#src/cli/shared/readonly-guard";
import { secretValueArgs } from "./args";
import { checkVaultManaged, releaseVaultOwnership } from "./check-vault-managed";

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
    await assertWritable({ profile: args.profile });
    const accessToken = await loadAccessToken({
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const managed = await checkVaultManaged({
      client,
      workspaceId,
      vaultName: args["vault-name"],
    });
    if (managed.isManaged && !args.yes) {
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
          throw new Error(`Vault "${args["vault-name"]}" not found.`, { cause: error });
        }
        if (error.code === Code.AlreadyExists) {
          throw new Error(`Secret "${args.name}" already exists.`, { cause: error });
        }
      }
      throw error;
    }

    if (managed.isManaged) {
      await releaseVaultOwnership({ client, ...managed });
    }

    logger.success(`Secret: ${args.name} created in vault: ${args["vault-name"]}`);
  },
});
