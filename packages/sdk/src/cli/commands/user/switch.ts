import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import {
  platformConfigFromProfile,
  readPlatformConfig,
  resolveConfigUser,
  writePlatformConfig,
} from "#/cli/shared/context";
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
    const activeProfileName = process.env.TAILOR_PLATFORM_PROFILE;
    const activeProfileEntry = activeProfileName ? config.profiles[activeProfileName] : undefined;
    if (activeProfileName && !activeProfileEntry) {
      throw new Error(`Profile "${activeProfileName}" not found`);
    }
    const platformConfig = activeProfileEntry
      ? platformConfigFromProfile(activeProfileEntry)
      : undefined;

    if (args.user.includes("|")) {
      throw new Error(
        `User "${args.user}" looks like a platform-scoped token key. Pass the user name without the platform URL and select the platform with TAILOR_PLATFORM_URL or a profile.`,
      );
    }

    const user = resolveConfigUser(config, args.user, platformConfig);
    if (!user) {
      throw new Error(ml`
        User "${args.user}" not found.
        Please login first using 'tailor login' command to register this user.
      `);
    }

    if (activeProfileEntry) {
      activeProfileEntry.user = user;
    } else {
      config.current_user = user;
    }
    writePlatformConfig(config);

    logger.success(`Current user set to "${user}" successfully.`);
  },
});
