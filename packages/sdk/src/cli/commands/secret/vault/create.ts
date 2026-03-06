import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, withCommonArgs, workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { nameArgs } from "./args";

export const createCommand = defineCommand({
  name: "create",
  description: "Create a new Secret Manager vault.",
  args: z
    .object({
      ...commonArgs,
      ...workspaceArgs,
      ...nameArgs,
    })
    .strict(),
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
      await client.createSecretManagerVault({
        workspaceId,
        secretmanagerVaultName: args.name,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.AlreadyExists) {
        throw new Error(`Vault "${args.name}" already exists.`);
      }
      throw error;
    }

    logger.success(`Vault: ${args.name} created`);
  }),
});
