import { z } from "zod";
import { defineAppCommand } from "#src/cli/shared/command";
import { readPlatformConfig } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import ml from "#src/utils/multiline";

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all users.",
  args: z.object({}).strict(),
  run: async () => {
    const config = await readPlatformConfig();
    const jsonOutput = logger.jsonMode;

    const users = Object.keys(config.users);
    if (users.length === 0) {
      logger.info(ml`
        No users found.
        Please login first using 'tailor-sdk login' command to register a user.
      `);
      if (jsonOutput) {
        logger.out([]);
      }
      return;
    }

    if (jsonOutput) {
      logger.out(users);
      return;
    }

    users.forEach((user) => {
      if (user === config.current_user) {
        logger.success(`${user} (current)`, { mode: "plain" });
      } else {
        logger.log(user);
      }
    });
  },
});
