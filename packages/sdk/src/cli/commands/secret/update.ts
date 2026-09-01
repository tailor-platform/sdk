import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { secretValueArgs } from "./args";
import { checkVaultManaged, releaseVaultOwnership } from "./check-vault-managed";

export const updateSecretCommand = defineAppCommand({
  name: "update",
  description: "Update a secret in a vault.",
  args: z.strictObject({
    ...workspaceArgs,
    ...secretValueArgs,
    ...confirmationArgs,
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
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
      await client.updateSecretManagerSecret({
        workspaceId,
        secretmanagerVaultName: args["vault-name"],
        secretmanagerSecretName: args.name,
        secretmanagerSecretValue: args.value,
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

    logger.success(`Secret: ${args.name} updated in vault: ${args["vault-name"]}`);
  },
});
