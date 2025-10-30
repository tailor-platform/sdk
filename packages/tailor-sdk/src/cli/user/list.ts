import { defineCommand } from "citty";
import { consola } from "consola";
import ml from "multiline-ts";
import {
  commonArgs,
  formatArgs,
  parseFormat,
  printWithFormat,
  withCommonArgs,
} from "../args";
import { readPlatformConfig } from "../context";
import type { UserInfo } from ".";

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all users",
  },
  args: {
    ...commonArgs,
    ...formatArgs,
  },
  run: withCommonArgs(async (args) => {
    // Validate args
    const format = parseFormat(args.format);

    const config = readPlatformConfig();

    const users = Object.entries(config.users);
    if (users.length === 0) {
      consola.info(ml`
        No users found.
        Please login first using 'tailor-sdk login' command to register a user.
      `);
      return;
    }

    // Show users info
    const userInfos: UserInfo[] = users.map(([email, user]) => {
      const tokenExpiresAt = new Date(user!.token_expires_at).toISOString();
      return {
        user: email,
        tokenExpiresAt,
      };
    });
    printWithFormat(userInfos, format);
  }),
});
