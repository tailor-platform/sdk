import chalk from "chalk";
import { defineCommand } from "citty";
import { consola } from "consola";
import ml from "multiline-ts";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { readPlatformConfig } from "../context";

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
      consola.info(ml`
        No users found.
        Please login first using 'tailor-sdk login' command to register a user.
      `);
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(users));
      return;
    }

    users.forEach((user) => {
      if (user === config.current_user) {
        console.log(chalk.green.bold(`${user} (current)`));
      } else {
        console.log(user);
      }
    });
  }),
});
