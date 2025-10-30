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
import { readPlatformConfig, writePlatformConfig } from "../context";
import type { UserInfo } from ".";

export const useCommand = defineCommand({
  meta: {
    name: "use",
    description: "Set current user",
  },
  args: {
    ...commonArgs,
    ...formatArgs,
    user: {
      type: "positional",
      description: "User email",
      required: true,
    },
  },
  run: withCommonArgs(async (args) => {
    // Validate args
    const format = parseFormat(args.format);

    const config = readPlatformConfig();

    // Check if user exists
    if (!config.users[args.user]) {
      throw new Error(ml`
        User "${args.user}" not found.
        Please login first using 'tailor-sdk login' command to register this user.
      `);
    }

    // Set current user
    config.current_user = args.user;
    writePlatformConfig(config);

    if (format === "table") {
      consola.success(`Current user set to "${args.user}" successfully.`);
    }

    // Show user info
    const user = config.users[config.current_user]!;
    const tokenExpiresAt = new Date(user.token_expires_at).toISOString();
    const userInfo: UserInfo = {
      user: config.current_user,
      tokenExpiresAt,
    };
    printWithFormat(userInfo, format);
  }),
});
