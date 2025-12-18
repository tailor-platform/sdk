import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { commonArgs, withCommonArgs, workspaceArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";

export const deleteSecretCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete a secret in a vault",
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
    yes: {
      type: "boolean",
      description: "Skip confirmation prompt",
      alias: "y",
      default: false,
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

    if (!args.yes) {
      const confirmation = await logger.prompt(
        `Enter the secret name to confirm deletion ("${args.name}"): `,
        { type: "text" },
      );

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
        throw new Error(
          `Secret "${args.name}" not found in vault "${args["vault-name"]}".`,
        );
      }
      throw error;
    }

    logger.success(
      `Secret: ${args.name} deleted from vault: ${args["vault-name"]}`,
    );
  }),
});
