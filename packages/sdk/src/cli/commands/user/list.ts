import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";
import { readPlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import ml from "@/utils/multiline";

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all users.",
  args: z.object({}).strict(),
  run: async (args) => {
    const config = await readPlatformConfig();
    const jsonOutput = args.json || logger.jsonMode;

    const users = Object.keys(config.users);
    if (users.length === 0) {
      if (jsonOutput) {
        logger.out([]);
        return;
      }

      logger.info(ml`
        No users found.
        Please login first using 'tailor-sdk login' command to register a user.
      `);
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
