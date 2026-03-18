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
    const pfConfig = readPlatformConfig();
    const userEntry = pfConfig.current_user ? pfConfig.users[pfConfig.current_user] : undefined;
    if (!userEntry) {
      logger.info("You are not logged in.");
      return;
    }

    // Resolve tokens from keyring or config for revocation
    let accessToken: string | undefined;
    let refreshToken: string | undefined;
    try {
      const tokens = await resolveTokens(userEntry, pfConfig.current_user!);
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
    } catch {
      // Tokens may already be missing from keyring — continue with logout
    }

    if (refreshToken && accessToken) {
      try {
        const client = initOAuth2Client();
        await client.revoke(
          {
            accessToken,
            refreshToken,
            expiresAt: Date.parse(userEntry.token_expires_at),
          },
          "refresh_token",
        );
      } catch {
        // Best-effort revocation — continue with local logout
      }
    }

    await deleteUserTokens(pfConfig, pfConfig.current_user!);
    delete pfConfig.users[pfConfig.current_user!];
    pfConfig.current_user = null;
    writePlatformConfig(pfConfig);
    logger.success("Successfully logged out from Tailor Platform.");
  },
});
