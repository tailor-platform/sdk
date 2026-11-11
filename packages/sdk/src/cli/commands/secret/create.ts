import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { printMutationResult } from "#/cli/shared/mutation-result";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { secretValueArgs, secretValueNotes } from "./args";
import { releaseVaultOwnership } from "./check-vault-managed";
import { prepareSecretWrite } from "./prepare-write";
import { resolveSecretValue } from "./value";

export const createSecretCommand = defineAppCommand({
  name: "create",
  description: "Create a secret in a vault.",
  args: z.strictObject({
    ...workspaceArgs,
    ...secretValueArgs,
    ...confirmationArgs,
  }),
  notes: secretValueNotes("create"),
  run: async (args) => {
    const value = await resolveSecretValue(args, process.stdin, "secret create");
    logger.registerSecret(value);
    await assertWritable({ profile: args.profile });
    const { client, workspaceId, managed } = await prepareSecretWrite(args, "create");
    try {
      await client.createSecretManagerSecret({
        workspaceId,
        secretmanagerVaultName: args["vault-name"],
        secretmanagerSecretName: args.name,
        secretmanagerSecretValue: value,
      });
    } catch (error) {
      if (error instanceof ConnectError) {
        if (error.code === Code.NotFound) {
          throw CLIError({
            code: "VAULT_NOT_FOUND",
            message: `Vault "${args["vault-name"]}" not found.`,
            cause: error,
          });
        }
        if (error.code === Code.AlreadyExists) {
          throw CLIError({
            code: "SECRET_EXISTS",
            message: `Secret "${args.name}" already exists.`,
            cause: error,
          });
        }
      }
      throw error;
    }

    if (managed.isManaged) {
      await releaseVaultOwnership({ client, ...managed });
    }

    logger.success(`Secret: ${args.name} created in vault: ${args["vault-name"]}`);
    printMutationResult({
      changed: true,
      workspaceId,
      vaultName: args["vault-name"],
      name: args.name,
      vaultOwnershipReleased: managed.isManaged,
    });
  },
});
