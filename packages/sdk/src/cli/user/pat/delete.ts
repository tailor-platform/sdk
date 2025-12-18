import { defineCommand } from "citty";
import ml from "multiline-ts";
import { commonArgs, withCommonArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { fetchLatestToken, readPlatformConfig } from "../../context";
import { logger } from "../../utils/logger";

export const deleteCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete personal access token",
  },
  args: {
    ...commonArgs,
    name: {
      type: "positional",
      description: "Token name",
      required: true,
    },
  },
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

    logger.success(
      `Personal access token "${args.name}" deleted successfully.`,
    );
  }),
});
