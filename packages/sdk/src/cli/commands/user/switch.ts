import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import { findConfigUserKey, readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import ml from "#/utils/multiline";

export const switchCommand = defineAppCommand({
  name: "switch",
  description: "Set current user.",
  args: z.strictObject({
    user: arg(z.string(), {
      positional: true,
      description: "User email address or machine user client ID",
    }),
  }),
  run: async (args) => {
    const config = await readPlatformConfig();

    const user = findConfigUserKey(config, args.user);
    if (!user) {
      throw new Error(ml`
        User "${args.user}" not found.
        Please login first using 'tailor login' command to register this user.
      `);
    }

    config.current_user = user;
    writePlatformConfig(config);

    logger.success(`Current user set to "${args.user}" successfully.`);
  },
});
