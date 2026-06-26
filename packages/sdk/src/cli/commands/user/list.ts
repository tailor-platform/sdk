import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import { readPlatformConfig } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import ml from "#/utils/multiline";

type UserListInfo = {
  user: string;
  platformUrl: string | null;
  current: boolean;
};

function toUserListInfo(userKey: string, currentUser: string | null): UserListInfo {
  const separatorIndex = userKey.indexOf("|");
  const platformUrl = separatorIndex === -1 ? null : userKey.slice(0, separatorIndex);
  const user = separatorIndex === -1 ? userKey : userKey.slice(separatorIndex + 1);
  return {
    user,
    platformUrl,
    current: currentUser === user,
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

    const activeProfile = process.env.TAILOR_PLATFORM_PROFILE;
    const currentUser = activeProfile
      ? (config.profiles[activeProfile]?.user ?? null)
      : config.current_user;
    const userInfos = users.map((user) => toUserListInfo(user, currentUser));
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
