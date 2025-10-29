import * as crypto from "node:crypto";
import * as http from "node:http";
import { defineCommand } from "citty";
import { consola } from "consola";
import open from "open";
import { commonArgs, withCommonArgs } from "./args";
import { userAgent } from "./client";
import { writeTailorctlConfig } from "./tailorctl";

// Since we need to specify an allowed callback, use the same value as tailorctl for now.
const CALLBACK_PORT = 8085;
const CALLBACK_URL = `http://tailorctl.tailor.tech:${CALLBACK_PORT}/callback`;

export const PLATFORM_AUTH_URL = "https://api.tailor.tech/auth/platform";
const LOGIN_URL = PLATFORM_AUTH_URL + "/login";
const TOKEN_URL = PLATFORM_AUTH_URL + "/token";
const USER_INFO_URL = PLATFORM_AUTH_URL + "/userinfo";

const randomState = () => {
  return crypto.randomBytes(32).toString("base64url");
};

interface TokenResponse {
  email: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

const exchangeCode = async (code: string) => {
  const body = new URLSearchParams();
  body.append("code", code);
  body.append("redirect_uri", CALLBACK_URL);

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "User-Agent": await userAgent(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!resp.ok) {
    throw new Error(`Failed to exchange code: ${resp.statusText}`);
  }

  return (await resp.json()) as TokenResponse;
};

interface UserInfoResponse {
  email: string;
}

const fetchUserInfo = async (accessToken: string) => {
  const resp = await fetch(USER_INFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": await userAgent(),
    },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch user info: ${resp.statusText}`);
  }

  return (await resp.json()) as UserInfoResponse;
};

const startAuthServer = async () => {
  return new Promise<void>((resolve, reject) => {
    const state = randomState();
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url?.startsWith("/callback")) {
          res.writeHead(404);
          const msg = "Invalid callback URL";
          res.end(msg);
          reject(msg);
          return;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const receivedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        if (receivedState !== state) {
          res.writeHead(400);
          const msg = "Invalid state parameter";
          res.end(msg);
          reject(msg);
          return;
        }
        if (!code) {
          res.writeHead(400);
          const msg = "Missing authorization code";
          res.end(msg);
          reject(msg);
          return;
        }

        const tokens = await exchangeCode(code);
        const userInfo = await fetchUserInfo(tokens.access_token);

        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expires_in);
        writeTailorctlConfig({
          username: userInfo.email,
          controlplaneaccesstoken: tokens.access_token,
          controlplanerefreshtoken: tokens.refresh_token,
          controlplanetokenexpiresat: expiresAt.toISOString(),
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            message: "Successfully authenticated. Please close this window.",
          }),
        );
        resolve();
      } catch (error) {
        res.writeHead(500);
        res.end("Internal server error");
        reject(error);
      } finally {
        // Close the server after handling one request.
        server.close();
      }
    });

    const timeout = setTimeout(
      () => {
        server.close();
        reject(new Error("Login timeout exceeded"));
      },
      5 * 60 * 1000,
    );

    server.on("close", () => {
      clearTimeout(timeout);
    });

    server.on("error", (error) => {
      reject(error);
    });

    server.listen(CALLBACK_PORT, async () => {
      const loginUrl = new URL(LOGIN_URL);
      loginUrl.searchParams.set("redirect_uri", CALLBACK_URL);
      loginUrl.searchParams.set("state", state);

      consola.info(`Opening browser for login:\n\n${loginUrl.href}\n`);
      try {
        await open(loginUrl.href);
      } catch {
        consola.warn(
          "Failed to open browser automatically. Please open the URL above manually.",
        );
      }
    });
  });
};

export const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Login to Tailor Platform",
  },
  args: commonArgs,
  run: withCommonArgs(async () => {
    await startAuthServer();
    consola.success("Successfully logged in to Tailor Platform.");
  }),
});
