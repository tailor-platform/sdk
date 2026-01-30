import ml from "multiline-ts";
import { defineCommand, arg } from "politty";
import { z } from "zod";
import { commonArgs, withCommonArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { fetchLatestToken, readPlatformConfig } from "../../context";
import { logger } from "../../utils/logger";

export const deleteCommand = defineCommand({
  name: "delete",
  description: "Delete personal access token",
  args: z.object({
    ...commonArgs,
    name: arg(z.string(), {
      positional: true,
      description: "Token name",
    }),
  }),
  run: withCommonArgs(async (args) => {
    const config = readPlatformConfig();

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
  }),
});
