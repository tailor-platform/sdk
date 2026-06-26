import { z } from "zod";
import { defaultPlatformBaseUrl, normalizeBaseUrl } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { readPlatformConfig } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import ml from "#/utils/multiline";

type PlatformConfig = Awaited<ReturnType<typeof readPlatformConfig>>;

type UserListInfo = {
  user: string;
  platformUrl: string | null;
  current: boolean;
};

function platformUserKeyFor(user: string, platformUrl?: string): string {
  if (!platformUrl) return user;
  const normalizedPlatformUrl = normalizeBaseUrl(platformUrl);
  if (normalizedPlatformUrl === normalizeBaseUrl(defaultPlatformBaseUrl)) {
    return user;
  }
  return `${normalizedPlatformUrl}|${user}`;
}

function currentUserKeyFor(config: PlatformConfig, user: string, platformUrl?: string): string {
  const selectedUserKey = platformUserKeyFor(user, platformUrl);
  return config.users[selectedUserKey] ? selectedUserKey : user;
}

function activeCurrentUserKey(config: PlatformConfig): string | null {
  const activeProfile = process.env.TAILOR_PLATFORM_PROFILE;
  if (!activeProfile) {
    if (!config.current_user) return null;
    return currentUserKeyFor(config, config.current_user, process.env.PLATFORM_URL);
  }
  const profile = config.profiles[activeProfile];
  if (!profile) return null;
  return currentUserKeyFor(config, profile.user, profile.platform_url ?? process.env.PLATFORM_URL);
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
  args: z.object({}).strict(),
  run: async () => {
    const config = await readPlatformConfig();
    const jsonOutput = logger.jsonMode;

    const users = Object.keys(config.users);
    if (users.length === 0) {
      logger.info(ml`
        No users found.
        Please login first using 'tailor-sdk login' command to register a user.
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
