import ml from "multiline-ts";
import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs } from "@/cli/shared/args";
import { readPlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";

export const listCommand = defineCommand({
  name: "list",
  description: "List all users.",
  args: z
    .object({
      ...commonArgs,
      ...jsonArgs,
    })
    .strict(),
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
