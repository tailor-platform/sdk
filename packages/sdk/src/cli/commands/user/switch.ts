import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import {
  hasUserTokenEntry,
  loadPlatformClientConfig,
  readPlatformConfig,
  writePlatformConfig,
} from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import ml from "#/utils/multiline";

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
    const platformConfig = await loadPlatformClientConfig();
    const config = await readPlatformConfig();

    if (args.user.includes("|")) {
      throw new Error(
        `User "${args.user}" looks like a platform-scoped token key. Pass the user name without the platform URL and select the platform with PLATFORM_URL or a profile.`,
      );
    }

    // Check if user exists
    if (!hasUserTokenEntry(config, args.user, platformConfig)) {
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
