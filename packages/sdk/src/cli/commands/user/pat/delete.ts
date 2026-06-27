import { arg } from "politty";
import { z } from "zod";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { fetchLatestToken, readPlatformConfig } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import ml from "#/utils/multiline";

export const deleteCommand = defineAppCommand({
  name: "delete",
  description: "Delete a personal access token.",
  args: z.strictObject({
    name: arg(z.string(), {
      positional: true,
      description: "Token name",
    }),
  }),
  run: async (args) => {
    await assertWritable();
    const config = await readPlatformConfig();

    if (!config.current_user) {
      throw new Error(ml`
        No user logged in.
        Please login first using 'tailor-sdk login' command.
      `);
    }

    const token = await fetchLatestToken(config, config.current_user);
    const client = await initOperatorClient(token);

    await client.deletePersonalAccessToken({
      name: args.name,
    });

    logger.success(`Personal access token "${args.name}" deleted successfully.`);
  },
});
