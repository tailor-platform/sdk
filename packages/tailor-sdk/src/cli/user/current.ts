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
import { type UserInfo } from ".";

export const currentCommand = defineCommand({
  meta: {
    name: "current",
    description: "Show current user",
  },
  args: {
    ...commonArgs,
    ...formatArgs,
  },
  run: withCommonArgs(async (args) => {
    // Validate args
    const format = parseFormat(args.format);

    const config = readPlatformConfig();

    // Check if current user is set
    if (!config.current_user) {
      consola.warn(ml`
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
    const user = config.users[config.current_user]!;

    // Show user info
    const tokenExpiresAt = new Date(user.token_expires_at).toISOString();
    const userInfo: UserInfo = {
      user: config.current_user,
      tokenExpiresAt,
    };
    printWithFormat(userInfo, format);
  }),
});
