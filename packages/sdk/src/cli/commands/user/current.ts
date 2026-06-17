import { z } from "zod";
import { defineAppCommand } from "#src/cli/shared/command";
import { readPlatformConfig } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import ml from "#src/utils/multiline";

export const currentCommand = defineAppCommand({
  name: "current",
  description: "Show current user.",
  args: z.object({}).strict(),
  run: async () => {
    const config = await readPlatformConfig();
    const jsonOutput = logger.jsonMode;

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

    if (jsonOutput) {
      logger.out({ user: config.current_user });
      return;
    }

    logger.out(config.current_user);
  },
});
