import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, withCommonArgs } from "@/cli/shared/args";
import { initOAuth2Client } from "@/cli/shared/client";
import { readPlatformConfig, writePlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";

export const logoutCommand = defineCommand({
  name: "logout",
  description: "Logout from Tailor Platform.",
  args: z.object({
    ...commonArgs,
  }),
  run: withCommonArgs(async () => {
    const pfConfig = readPlatformConfig();
    const tokens = pfConfig.current_user ? pfConfig.users[pfConfig.current_user] : undefined;
    if (!tokens) {
      logger.info("You are not logged in.");
      return;
    }

    const client = initOAuth2Client();
    client.revoke(
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.parse(tokens.token_expires_at),
      },
      "refresh_token",
    );

    delete pfConfig.users[pfConfig.current_user!];
    pfConfig.current_user = null;
    writePlatformConfig(pfConfig);
    logger.success("Successfully logged out from Tailor Platform.");
  }),
});
