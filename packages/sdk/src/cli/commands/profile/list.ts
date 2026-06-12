import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";
import { readPlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import ml from "@/utils/multiline";
import type { ProfileInfo } from "./types";

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all profiles.",
  args: z.object({}).strict(),
  run: async () => {
    const config = await readPlatformConfig();
    const jsonOutput = logger.jsonMode;

    const profiles = Object.entries(config.profiles);
    if (profiles.length === 0) {
      logger.info(ml`
        No profiles found.
        Please create a profile first using 'tailor-sdk profile create' command.
      `);
      if (jsonOutput) {
        logger.out([]);
      }
      return;
    }

    const profileInfos: ProfileInfo[] = profiles.map(([name, profile]) => ({
      name,
      user: profile!.user,
      workspaceId: profile!.workspace_id,
      permission: profile!.readonly === true ? "read" : "write",
      ...(profile!.machine_user ? { machineUser: profile!.machine_user } : {}),
    }));
    logger.out(profileInfos);
  },
});
