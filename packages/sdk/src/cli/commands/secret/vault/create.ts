import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { workspaceArgs } from "#src/cli/shared/args";
import { initOperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import { assertWritable } from "#src/cli/shared/readonly-guard";
import { nameArgs } from "./args";

export const createCommand = defineAppCommand({
  name: "create",
  description: "Create a new Secret Manager vault.",
  args: z
    .object({
      ...workspaceArgs,
      ...nameArgs,
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

    try {
      await client.createSecretManagerVault({
        workspaceId,
        secretmanagerVaultName: args.name,
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.AlreadyExists) {
        throw new Error(`Vault "${args.name}" already exists.`, { cause: error });
      }
      throw error;
    }

    logger.success(`Vault: ${args.name} created`);
  },
});
