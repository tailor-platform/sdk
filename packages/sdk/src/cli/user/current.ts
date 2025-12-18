import { defineCommand } from "citty";
import ml from "multiline-ts";
import { commonArgs, withCommonArgs } from "../args";
import { readPlatformConfig } from "../context";
import { logger } from "../utils/logger";

export const currentCommand = defineCommand({
  meta: {
    name: "current",
    description: "Show current user",
  },
  args: commonArgs,
  run: withCommonArgs(async () => {
    const config = readPlatformConfig();

    // Check if current user is set
    if (!config.current_user) {
      logger.warn(ml`
        Current user not set.
        Please login first using 'tailor-sdk login' command to register a user.
      `);
      return;
    }

    // Check if user exists
    if (!config.users[config.current_user]) {
      throw new Error(ml`
        Current user '${config.current_user}' not found in registered users.
        Please login again using 'tailor-sdk login' command to register the user.
      `);
    }

    console.log(config.current_user);
  }),
});
