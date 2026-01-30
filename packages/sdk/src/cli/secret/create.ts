import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, withCommonArgs, workspaceArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import { secretValueArgs } from "./args";

export const createSecretCommand = defineCommand({
  name: "create",
  description: "Create a secret in a vault",
  args: z.object({
    ...commonArgs,
    ...workspaceArgs,
    ...secretValueArgs,
  }),
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

    logger.success(`Secret: ${args.name} created in vault: ${args["vault-name"]}`);
  }),
});
