import { defineCommand } from "citty";
import ml from "multiline-ts";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { readPlatformConfig } from "../context";
import { logger } from "../utils/logger";

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all users",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
  },
  run: withCommonArgs(async (args) => {
    const config = readPlatformConfig();

    const users = Object.keys(config.users);
    if (users.length === 0) {
      logger.info(ml`
        No users found.
        Please login first using 'tailor-sdk login' command to register a user.
      `);
      return;
    }

    if (args.json) {
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
  }),
});
