import ml from "multiline-ts";
import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { readPlatformConfig } from "../context";
import { logger } from "../utils/logger";
import type { ProfileInfo } from ".";

export const listCommand = defineCommand({
  name: "list",
  description: "List all profiles",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
  }),
  run: withCommonArgs(async () => {
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
  }),
});
