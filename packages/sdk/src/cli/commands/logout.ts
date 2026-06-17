import { z } from "zod";
import { initOAuth2Client } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import {
  deleteUserTokens,
  readPlatformConfig,
  resolveTokens,
  writePlatformConfig,
} from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";

export const logoutCommand = defineAppCommand({
  name: "logout",
  description: "Logout from Tailor Platform.",
  args: z.object({}).strict(),
  run: async () => {
    const pfConfig = await readPlatformConfig();
    const currentUser = pfConfig.current_user;
    const userEntry = currentUser ? pfConfig.users[currentUser] : undefined;
    if (!userEntry || !currentUser) {
      logger.info("You are not logged in.");
      return;
    }

    try {
      const { accessToken, refreshToken } = await resolveTokens(userEntry, currentUser);
      const client = initOAuth2Client();
      const tokenTypeHint = refreshToken ? "refresh_token" : "access_token";
      await client.revoke(
        {
          accessToken,
          refreshToken: refreshToken ?? null,
          expiresAt: Date.parse(userEntry.token_expires_at),
        },
        tokenTypeHint,
      );
    } catch (error) {
      logger.warn(`Failed to revoke token: ${error instanceof Error ? error.message : error}`);
    }

    await deleteUserTokens(pfConfig, currentUser);
    delete pfConfig.users[currentUser];
    pfConfig.current_user = null;
    writePlatformConfig(pfConfig);
    logger.success("Successfully logged out from Tailor Platform.");
  },
});
