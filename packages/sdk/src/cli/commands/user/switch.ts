import ml from "multiline-ts";
import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";
import { readPlatformConfig, writePlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";

export const switchCommand = defineAppCommand({
  name: "switch",
  description: "Set current user.",
  args: z
    .object({
      user: arg(z.string(), {
        positional: true,
        description: "User email",
      }),
    })
    .strict(),
  run: async (args) => {
    const config = await readPlatformConfig();

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

    logger.success(`Current user set to "${args.user}" successfully.`);
  },
});
