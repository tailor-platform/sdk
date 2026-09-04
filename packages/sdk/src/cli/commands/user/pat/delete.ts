import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { createPatOperatorClient } from "./user";

export const deleteCommand = defineAppCommand({
  name: "delete",
  description: "Delete a personal access token.",
  args: z.strictObject({
    name: arg(z.string(), {
      positional: true,
      description: "Token name",
    }),
    profile: workspaceArgs.profile,
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const client = await createPatOperatorClient(args.profile);

    await client.deletePersonalAccessToken({
      name: args.name,
    });

    logger.success(`Personal access token "${args.name}" deleted successfully.`);
  },
});
