import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import {
  hasUserTokenEntry,
  platformConfigFromProfile,
  readPlatformConfig,
} from "#/cli/shared/context";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";

export const currentCommand = defineAppCommand({
  name: "current",
  description: "Show current user.",
  args: z.strictObject({ profile: workspaceArgs.profile }),
  run: async (args) => {
    const config = await readPlatformConfig();
    const profile = args.profile || process.env.TAILOR_PLATFORM_PROFILE;
    const profileEntry = profile ? config.profiles[profile] : undefined;
    if (profile && !profileEntry) {
      throw CLIError({ code: "PROFILE_NOT_FOUND", message: `Profile "${profile}" not found` });
    }
    const platformConfig = profileEntry ? platformConfigFromProfile(profileEntry) : undefined;
    const currentUser = profile ? (profileEntry?.user ?? null) : config.current_user;
    const jsonOutput = logger.jsonMode;

    // Check if current user is set
    if (!currentUser) {
      throw CLIError({
        code: "USER_NOT_SET",
        message: "Current user not set.",
        suggestion: "Log in first to register a user.",
        next: { command: "tailor", args: profile ? ["login", "--profile", profile] : ["login"] },
      });
    }

    // Check if user exists
    if (!hasUserTokenEntry(config, currentUser, platformConfig)) {
      throw CLIError({
        code: "USER_NOT_FOUND",
        message: `Current user '${currentUser}' not found in registered users.`,
        suggestion: "Log in again to register the user.",
        next: { command: "tailor", args: profile ? ["login", "--profile", profile] : ["login"] },
      });
    }

    if (jsonOutput) {
      logger.out({ user: currentUser });
      return;
    }

    logger.out(currentUser);
  },
});
