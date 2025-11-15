import { defineCommand } from "citty";
import { consola } from "consola";
import ml from "multiline-ts";
import { commonArgs, withCommonArgs } from "../args";
import { readPlatformConfig, writePlatformConfig } from "../context";

export const useCommand = defineCommand({
  meta: {
    name: "use",
    description: "Set current user",
  },
  args: {
    ...commonArgs,
    user: {
      type: "positional",
      description: "User email",
      required: true,
    },
  },
  run: withCommonArgs(async (args) => {
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

    consola.success(`Current user set to "${args.user}" successfully.`);
  }),
});
