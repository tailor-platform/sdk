import ml from "multiline-ts";
import { z } from "zod";
import { jsonArgs, setupCommonArgs } from "@/cli/shared/args";
import { defineAppCommand } from "@/cli/shared/command";
import { readPlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import type { ProfileInfo } from ".";

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all profiles.",
  args: z
    .object({
      ...jsonArgs,
    })
    .strict(),
  run: async (args) => {
    setupCommonArgs(args);
    const config = readPlatformConfig();

    const profiles = Object.entries(config.profiles);
    if (profiles.length === 0) {
      logger.info(ml`
        No profiles found.
        Please create a profile first using 'tailor-sdk profile create' command.
      `);
      return;
    }

    const profileInfos: ProfileInfo[] = profiles.map(([name, profile]) => ({
      name,
      user: profile!.user,
      workspaceId: profile!.workspace_id,
    }));
    logger.out(profileInfos);
  },
});
