import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import {
  hasUserTokenEntry,
  platformConfigFromProfile,
  readPlatformConfig,
} from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import ml from "#/utils/multiline";

export const currentCommand = defineAppCommand({
  name: "current",
  description: "Show current user.",
  args: z.strictObject({}),
  run: async () => {
    const config = await readPlatformConfig();
    const profile = process.env.TAILOR_PLATFORM_PROFILE;
    const profileEntry = profile ? config.profiles[profile] : undefined;
    if (profile && !profileEntry) {
      throw new Error(`Profile "${profile}" not found`);
    }
    const platformConfig = profileEntry ? platformConfigFromProfile(profileEntry) : undefined;
    const currentUser = profile ? (profileEntry?.user ?? null) : config.current_user;
    const jsonOutput = logger.jsonMode;

    // Check if current user is set
    if (!currentUser) {
      throw new Error(ml`
        Current user not set.
        Please login first using 'tailor login' command to register a user.
      `);
    }

    // Check if user exists
    if (!hasUserTokenEntry(config, currentUser, platformConfig)) {
      throw new Error(ml`
        Current user '${currentUser}' not found in registered users.
        Please login again using 'tailor login' command to register the user.
      `);
    }

    if (jsonOutput) {
      logger.out({ user: currentUser });
      return;
    }

    logger.out(currentUser);
  },
});
