import { defineCommand } from "citty";
import { consola } from "consola";

import { userAgent } from "./client";
import { readTailorctlConfig, writeTailorctlConfig } from "./tailorctl";
import { PLATFORM_AUTH_URL } from "./login";

const LOGOUT_URL = PLATFORM_AUTH_URL + "/logout";

export const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "Logout from Tailor Platform",
  },
  async run() {
    const tailorctlConfig = readTailorctlConfig();
    const token = tailorctlConfig?.controlplaneaccesstoken;
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
      consola.error(`Failed to logout: ${resp.statusText}`);
      process.exit(1);
    }

    writeTailorctlConfig({
      username: "",
      controlplaneaccesstoken: "",
      controlplanerefreshtoken: "",
      controlplanetokenexpiresat: "",
    });
    consola.success("Successfully logged out from Tailor Platform.");
  },
});
