import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { commonArgs, withCommonArgs, workspaceArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";

export const createSecretCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create a secret in a vault",
  },
  args: {
    ...commonArgs,
    ...workspaceArgs,
    "vault-name": {
      type: "string",
      description: "Vault name",
      required: true,
    },
    name: {
      type: "string",
      description: "Secret name",
      required: true,
    },
    value: {
      type: "string",
      description: "Secret value",
      required: true,
    },
  },
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

    logger.success(
      `Secret: ${args.name} created in vault: ${args["vault-name"]}`,
    );
  }),
});
