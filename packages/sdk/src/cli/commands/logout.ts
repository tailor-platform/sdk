import { z } from "zod";
import { initOAuth2Client } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import {
  deleteUserTokens,
  loadStoredUserTokens,
  readPlatformConfig,
  writePlatformConfig,
} from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";

export const logoutCommand = defineAppCommand({
  name: "logout",
  description: "Logout from Tailor Platform.",
  args: z.object({}).strict(),
  run: async () => {
    const pfConfig = await readPlatformConfig();
    const currentUser = pfConfig.current_user;
    if (!currentUser) {
      logger.info("You are not logged in.");
      return;
    }
    const storedTokens = await loadStoredUserTokens(pfConfig, currentUser);
    if (!storedTokens) {
      logger.info("You are not logged in.");
      pfConfig.current_user = null;
      writePlatformConfig(pfConfig);
      return;
    }

    try {
      const client = initOAuth2Client();
      const tokenTypeHint = storedTokens.refreshToken ? "refresh_token" : "access_token";
      await client.revoke(
        {
          accessToken: storedTokens.accessToken,
          refreshToken: storedTokens.refreshToken ?? null,
          expiresAt: Date.parse(storedTokens.userEntry.token_expires_at),
        },
        tokenTypeHint,
      );
    } catch (error) {
      logger.warn(`Failed to revoke token: ${error instanceof Error ? error.message : error}`);
    }

    await deleteUserTokens(pfConfig, currentUser);
    pfConfig.current_user = null;
    writePlatformConfig(pfConfig);
    logger.success("Successfully logged out from Tailor Platform.");
  },
});
