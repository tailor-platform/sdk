import { z } from "zod";
import { initOAuth2Client } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import {
  deleteUserTokens,
  readPlatformConfig,
  resolveTokens,
  writePlatformConfig,
} from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";

export const logoutCommand = defineAppCommand({
  name: "logout",
  description: "Logout from Tailor Platform.",
  args: z.object({}).strict(),
  run: async () => {
    const pfConfig = await readPlatformConfig();
    const userEntry = pfConfig.current_user ? pfConfig.users[pfConfig.current_user] : undefined;
    if (!userEntry) {
      logger.info("You are not logged in.");
      return;
    }

    try {
      const { accessToken, refreshToken } = await resolveTokens(userEntry, pfConfig.current_user!);
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

    await deleteUserTokens(pfConfig, pfConfig.current_user!);
    delete pfConfig.users[pfConfig.current_user!];
    pfConfig.current_user = null;
    writePlatformConfig(pfConfig);
    logger.success("Successfully logged out from Tailor Platform.");
  },
});
