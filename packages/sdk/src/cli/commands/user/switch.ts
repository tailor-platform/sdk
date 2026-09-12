import { arg } from "@politty/zod";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import {
  platformConfigFromProfile,
  readPlatformConfig,
  resolveConfigUser,
  writePlatformConfig,
} from "#/cli/shared/context";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";

export const switchCommand = defineAppCommand({
  name: "switch",
  description: "Set current user.",
  args: z.strictObject({
    user: arg(z.string(), {
      positional: true,
      description: "User email address or machine user client ID",
    }),
    profile: workspaceArgs.profile,
  }),
  run: async (args) => {
    const config = await readPlatformConfig();
    const activeProfileName = args.profile || process.env.TAILOR_PLATFORM_PROFILE;
    const activeProfileEntry = activeProfileName ? config.profiles[activeProfileName] : undefined;
    if (activeProfileName && !activeProfileEntry) {
      throw CLIError({
        code: "PROFILE_NOT_FOUND",
        message: `Profile "${activeProfileName}" not found`,
      });
    }
    const platformConfig = activeProfileEntry
      ? platformConfigFromProfile(activeProfileEntry)
      : undefined;

    if (args.user.includes("|")) {
      throw CLIError({
        code: "USER_NAME_INVALID",
        message: `User "${args.user}" looks like a platform-scoped token key. Pass the user name without the platform URL and select the platform with TAILOR_PLATFORM_URL or a profile.`,
        command: "user switch",
      });
    }

    const user = resolveConfigUser(config, args.user, platformConfig);
    if (!user) {
      throw CLIError({
        code: "USER_NOT_FOUND",
        message: `User "${args.user}" not found.`,
        suggestion: "Log in first to register this user.",
        next: {
          command: "tailor",
          args: activeProfileName ? ["login", "--profile", activeProfileName] : ["login"],
        },
      });
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
