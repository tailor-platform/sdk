import ml from "multiline-ts";
import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";
import { readPlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";

export const currentCommand = defineAppCommand({
  name: "current",
  description: "Show current user.",
  args: z.object({}).strict(),
  run: async () => {
    const config = await readPlatformConfig();

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
  },
});
