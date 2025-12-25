import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { commonArgs, withCommonArgs, workspaceArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import { secretValueArgs } from "./args";

export const updateSecretCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update a secret in a vault",
  },
  args: {
    ...commonArgs,
    ...workspaceArgs,
    ...secretValueArgs,
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
  }),
});
