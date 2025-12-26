import * as crypto from "node:crypto";
import * as http from "node:http";
import { generateCodeVerifier } from "@badgateway/oauth2-client";
import { defineCommand } from "citty";
import open from "open";
import { commonArgs, withCommonArgs } from "./args";
import { fetchUserInfo, initOAuth2Client } from "./client";
import { readPlatformConfig, writePlatformConfig } from "./context";
import { logger } from "./utils/logger";

const redirectPort = 8085;
const redirectUri = `http://localhost:${redirectPort}/callback`;

function randomState() {
  return crypto.randomBytes(32).toString("base64url");
}

const startAuthServer = async () => {
  const client = initOAuth2Client();
  const state = randomState();
  const codeVerifier = await generateCodeVerifier();

  return new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url?.startsWith("/callback")) {
          throw new Error("Invalid callback URL");
        }
        const tokens = await client.authorizationCode.getTokenFromCodeRedirect(
          `http://${req.headers.host}${req.url}`,
          {
            redirectUri: redirectUri,
            state,
            codeVerifier,
          },
        );
        const userInfo = await fetchUserInfo(tokens.accessToken);

        const pfConfig = readPlatformConfig();
        pfConfig.users = {
          ...pfConfig.users,
          [userInfo.email]: {
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken!,
            token_expires_at: new Date(tokens.expiresAt!).toISOString(),
          },
        };
        pfConfig.current_user = userInfo.email;
        writePlatformConfig(pfConfig);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            message: "Successfully authenticated. Please close this window.",
          }),
        );
        resolve();
      } catch (error) {
        res.writeHead(401);
        res.end("Authentication failed");
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

    server.listen(redirectPort, async () => {
      const authorizeUri = await client.authorizationCode.getAuthorizeUri({
        redirectUri,
        state,
        codeVerifier,
      });

      logger.info(`Opening browser for login:\n\n${authorizeUri}\n`);
      try {
        await open(authorizeUri);
      } catch {
        logger.warn("Failed to open browser automatically. Please open the URL above manually.");
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
    logger.success("Successfully logged in to Tailor Platform.");
  }),
});
