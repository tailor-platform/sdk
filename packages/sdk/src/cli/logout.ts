import { defineCommand } from "citty";
import { consola } from "consola";
import { commonArgs, withCommonArgs } from "./args";
import { initOAuth2Client } from "./client";
import { readPlatformConfig, writePlatformConfig } from "./context";

export const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "Logout from Tailor Platform",
  },
  args: commonArgs,
  run: withCommonArgs(async () => {
    const pfConfig = readPlatformConfig();
    const tokens = pfConfig.current_user
      ? pfConfig.users[pfConfig.current_user]
      : undefined;
    if (!tokens) {
      consola.warn("You are not logged in.");
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
    consola.success("Successfully logged out from Tailor Platform.");
  }),
});
