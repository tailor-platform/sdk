import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import { readPlatformConfig } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import ml from "#/utils/multiline";
import type { ProfileInfo } from "./types";

/**
 * Read every profile of the platform configuration.
 * @returns Profile entries in configuration order
 */
export async function listProfileInfos(): Promise<ProfileInfo[]> {
  const config = await readPlatformConfig();
  return Object.entries(config.profiles).map(([name, profile]) => {
    const p = assertDefined(profile, `profile entry "${name}" is undefined`);
    return {
      name,
      user: p.user,
      workspaceId: p.workspace_id,
      permission: p.readonly === true ? "read" : "write",
      ...(p.machine_user
        ? {
            machineUser: p.machine_user,
            machineUserOverride: p.machine_user_override ?? "allow",
          }
        : {}),
      ...(p.platform_url ? { platformUrl: p.platform_url } : {}),
      ...(p.oauth2_client_id ? { oauth2ClientId: p.oauth2_client_id } : {}),
      ...(p.console_url ? { consoleUrl: p.console_url } : {}),
    };
  });
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all profiles.",
  args: z.strictObject({}),
  run: async () => {
    const profileInfos = await listProfileInfos();
    if (profileInfos.length === 0) {
      logger.info(ml`
        No profiles found.
        Please create a profile first using 'tailor profile create' command.
      `);
      if (logger.jsonMode) {
        logger.out([]);
      }
      return;
    }
    logger.out(profileInfos);
  },
});
