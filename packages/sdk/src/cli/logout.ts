import { defineCommand } from "citty";
import { consola } from "consola";
import { commonArgs, withCommonArgs } from "./args";
import { oauth2ClientId, revokeToken } from "./client";
import { readPlatformConfig, writePlatformConfig } from "./context";

export const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "Logout from Tailor Platform",
  },
  args: commonArgs,
  run: withCommonArgs(async () => {
    const pfConfig = readPlatformConfig();
    if (!pfConfig.current_user) {
      consola.warn("You are not logged in.");
      return;
    }
    const token = pfConfig.users[pfConfig.current_user]?.refresh_token;
    if (!token) {
      consola.warn("You are not logged in.");
      return;
    }
    await revokeToken(token, oauth2ClientId);

    delete pfConfig.users[pfConfig.current_user];
    pfConfig.current_user = null;
    writePlatformConfig(pfConfig);
    consola.success("Successfully logged out from Tailor Platform.");
  }),
});
