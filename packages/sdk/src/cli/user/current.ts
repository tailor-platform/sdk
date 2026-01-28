import ml from "multiline-ts";
import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, withCommonArgs } from "../args";
import { readPlatformConfig } from "../context";
import { logger } from "../utils/logger";

export const currentCommand = defineCommand({
  name: "current",
  description: "Show current user",
  args: z.object({
    ...commonArgs,
  }),
  run: withCommonArgs(async () => {
    const config = readPlatformConfig();

    // Check if current user is set
    if (!config.current_user) {
      throw new Error(ml`
        Current user not set.
        Please login first using 'tailor-sdk login' command to register a user.
      `);
    }

    // Check if user exists
    if (!config.users[config.current_user]) {
      throw new Error(ml`
        Current user '${config.current_user}' not found in registered users.
        Please login again using 'tailor-sdk login' command to register the user.
      `);
    }

    logger.log(config.current_user);
  }),
});
