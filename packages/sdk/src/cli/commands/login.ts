import * as crypto from "node:crypto";
import * as http from "node:http";
import { generateCodeVerifier } from "@badgateway/oauth2-client";
import open from "open";
import { arg } from "politty";
import { z } from "zod";
import {
  closeConnectionPool,
  fetchPlatformMachineUserToken,
  fetchUserInfo,
  initOAuth2Client,
} from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { readPlatformConfig, saveUserTokens, writePlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { prompt } from "@/cli/shared/prompt";

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

        const pfConfig = await readPlatformConfig();
        await saveUserTokens(
          pfConfig,
          userInfo.email,
          {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken ?? undefined,
          },
          new Date(tokens.expiresAt!).toISOString(),
        );
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

async function loginAsMachineUser(args: { clientId: string; clientSecret?: string }) {
  const clientSecret = args.clientSecret ?? (await prompt.password({ message: "Client secret" }));
  const tokens = await fetchPlatformMachineUserToken(args.clientId, clientSecret);

  const pfConfig = await readPlatformConfig();
  await saveUserTokens(
    pfConfig,
    args.clientId,
    { accessToken: tokens.accessToken },
    new Date(tokens.expiresAt!).toISOString(),
  );
  pfConfig.current_user = args.clientId;
  writePlatformConfig(pfConfig);
}

export const loginCommand = defineAppCommand({
  name: "login",
  description: "Login to Tailor Platform.",
  args: z.xor([
    z.object({}).strict().describe("User Login"),
    z
      .object({
        "machine-user": arg(z.literal(true), {
          hiddenAlias: "machineuser",
          description: "Login as a platform machine user.",
          required: true,
        }),
        "client-id": arg(z.string(), {
          description: "Client ID",
          env: "TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID",
          required: true,
        }),
        "client-secret": arg(z.string().optional(), {
          description: "Client secret",
          env: "TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET",
        }),
      })
      .strict()
      .describe("Machine User Login"),
  ]),
  run: async (args) => {
    if ("machine-user" in args && args["machine-user"]) {
      await loginAsMachineUser({
        clientId: args.clientId,
        clientSecret: args.clientSecret,
      });
    } else {
      await startAuthServer();
    }
    logger.success("Successfully logged in to Tailor Platform.");
    await closeConnectionPool();
  },
});
