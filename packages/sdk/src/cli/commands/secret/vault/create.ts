import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { nameArgs } from "./args";

export const createCommand = defineAppCommand({
  name: "create",
  description: "Create a new Secret Manager vault.",
  args: z.strictObject({
    ...workspaceArgs,
    ...nameArgs,
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
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
