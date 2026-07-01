import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import {
  platformConfigFromProfile,
  readPlatformConfig,
  resolveUserTokenKey,
} from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import ml from "#/utils/multiline";

type PlatformConfig = Awaited<ReturnType<typeof readPlatformConfig>>;

type UserListInfo = {
  user: string;
  platformUrl: string | null;
  current: boolean;
};

function activeCurrentUserKey(config: PlatformConfig): string | null {
  const activeProfile = process.env.TAILOR_PLATFORM_PROFILE;
  if (!activeProfile) {
    if (!config.current_user) return null;
    return resolveUserTokenKey(config, config.current_user);
  }
  const profile = config.profiles[activeProfile];
  if (!profile) return null;
  return resolveUserTokenKey(config, profile.user, platformConfigFromProfile(profile));
}

function toUserListInfo(userKey: string, currentUserKey: string | null): UserListInfo {
  const separatorIndex = userKey.indexOf("|");
  const platformUrl = separatorIndex === -1 ? null : userKey.slice(0, separatorIndex);
  const user = separatorIndex === -1 ? userKey : userKey.slice(separatorIndex + 1);
  return {
    user,
    platformUrl,
    current: currentUserKey === userKey,
  };
}

function formatUserListInfo(info: UserListInfo): string {
  return `${info.user}${info.platformUrl ? ` [${info.platformUrl}]` : ""}${
    info.current ? " (current)" : ""
  }`;
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all users.",
  args: z.strictObject({}),
  run: async () => {
    const config = await readPlatformConfig();
    const jsonOutput = logger.jsonMode;

    const users = Object.keys(config.users);
    if (users.length === 0) {
      logger.info(ml`
        No users found.
        Please login first using 'tailor login' command to register a user.
      `);
      if (jsonOutput) {
        logger.out([]);
      }
      return;
    }

    const currentUserKey = activeCurrentUserKey(config);
    const userInfos = users.map((user) => toUserListInfo(user, currentUserKey));
    if (jsonOutput) {
      logger.out([...new Set(userInfos.map((userInfo) => userInfo.user))]);
      return;
    }

    userInfos.forEach((userInfo) => {
      if (userInfo.current) {
        logger.success(formatUserListInfo(userInfo), { mode: "plain" });
      } else {
        logger.log(formatUserListInfo(userInfo));
      }
    });
  },
});
