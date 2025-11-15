import { defineCommand } from "citty";
import { consola } from "consola";
import { commonArgs, withCommonArgs } from "./args";
import { userAgent } from "./client";
import { readPlatformConfig, writePlatformConfig } from "./context";
import { PLATFORM_AUTH_URL } from "./login";

const LOGOUT_URL = PLATFORM_AUTH_URL + "/logout";

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
    const token = pfConfig.users[pfConfig.current_user]?.access_token;
    if (!token) {
      consola.warn("You are not logged in.");
      return;
    }

    const resp = await fetch(LOGOUT_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": await userAgent(),
      },
    });
    if (!resp.ok) {
      throw new Error(`Failed to logout: ${resp.statusText}`);
    }

    delete pfConfig.users[pfConfig.current_user];
    pfConfig.current_user = null;
    writePlatformConfig(pfConfig);
    consola.success("Successfully logged out from Tailor Platform.");
  }),
});
