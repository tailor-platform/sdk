import * as crypto from "node:crypto";
import * as http from "node:http";
import { generateCodeVerifier } from "@badgateway/oauth2-client";
import { arg } from "@politty/valibot";
import open from "open";
import * as v from "valibot";
import {
  closeConnectionPool,
  fetchPlatformMachineUserToken,
  fetchUserInfo,
  initOAuth2Client,
  isDefaultPlatform,
  type PlatformClientConfig,
} from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import {
  platformConfigFromProfile,
  readPlatformConfig,
  removeLegacyUserAlias,
  saveUserTokens,
  writePlatformConfig,
} from "#/cli/shared/context";
import { toError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { assertDefined } from "#/utils/assert";
import ml from "#/utils/multiline";

const redirectPort = 8085;
const redirectUri = `http://localhost:${redirectPort}/callback`;
type ProfileLoginOptions = {
  profile?: string;
  profileUser?: string;
  platformConfig?: PlatformClientConfig;
  updateCurrentUser?: boolean;
  loginMode?: "user" | "machine-user";
};
type ProfileUserMismatch = {
  profile: string;
  oldUser: string;
  authenticatedUser: string;
  loginMode: "user" | "machine-user";
};

function randomState() {
  return crypto.randomBytes(32).toString("base64url");
}

function getProfileUserMismatch(
  args: ProfileLoginOptions,
  authenticatedUser: string,
  authenticatedSubject?: string,
): ProfileUserMismatch | undefined {
  if (
    !args.profile ||
    !args.profileUser ||
    authenticatedUser === args.profileUser ||
    authenticatedSubject === args.profileUser
  ) {
    return undefined;
  }
  return {
    profile: args.profile,
    oldUser: args.profileUser,
    authenticatedUser,
    loginMode: args.loginMode ?? "user",
  };
}

function quoteCommandArg(value: string, platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") {
    if (/^[A-Za-z0-9_./:@+=,-]+$/.test(value)) {
      return value;
    }
    return undefined;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function profileUpdateCommand(mismatch: ProfileUserMismatch) {
  const profileArg = quoteCommandArg(mismatch.profile);
  const userArg = quoteCommandArg(mismatch.authenticatedUser);
  if (profileArg && userArg) {
    return `tailor profile update --user ${userArg} -- ${profileArg}`;
  }
  return [
    "tailor profile update --user <authenticated-user> -- <profile>",
    `profile = ${JSON.stringify(mismatch.profile)}`,
    `authenticated user = ${JSON.stringify(mismatch.authenticatedUser)}`,
  ].join("\n");
}

function retryInstruction(mismatch: ProfileUserMismatch) {
  if (mismatch.loginMode === "machine-user") {
    return "Then retry the original machine-user login command.";
  }
  const profileArg = quoteCommandArg(mismatch.profile);
  if (!profileArg) {
    return "Then retry the browser login with the same profile value.";
  }
  return `Then run:\n  tailor login --profile ${profileArg}`;
}

function profileUserMismatchError(mismatch: ProfileUserMismatch) {
  const updateCommand = profileUpdateCommand(mismatch);
  const nextStep = retryInstruction(mismatch);
  return new Error(ml`
    Profile "${mismatch.profile}" is configured for "${mismatch.oldUser}", but login authenticated "${mismatch.authenticatedUser}".
    The authenticated user has been saved. To use it with this profile, run:
      ${updateCommand}
    ${nextStep}
  `);
}

function shouldUpdateCurrentUser(
  profile: string | undefined,
  platformConfig: PlatformClientConfig | undefined,
) {
  if (!profile) return true;
  return isDefaultPlatform(platformConfig);
}

const startAuthServer = async (args: ProfileLoginOptions = {}) => {
  const client = initOAuth2Client(args.platformConfig);
  const state = randomState();
  const codeVerifier = await generateCodeVerifier();
  // A fetch failure here rejects with TypeError, which the top-level handler
  // classifies as an SDK bug and crash-reports.
  const authorizeUri = await client.authorizationCode
    .getAuthorizeUri({ redirectUri, state, codeVerifier })
    .catch((error: unknown) => {
      throw new Error(`Failed to prepare the login authorization URL: ${toError(error).message}`, {
        cause: error,
      });
    });

  return new Promise<void>((resolve, reject) => {
    const handleCallback = async (
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ): Promise<void> => {
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
        const userInfo = await fetchUserInfo(tokens.accessToken, args.platformConfig);

        const pfConfig = await readPlatformConfig();
        await saveUserTokens(
          pfConfig,
          userInfo.sub,
          {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken ?? undefined,
          },
          new Date(
            assertDefined(tokens.expiresAt, "token response missing expiresAt"),
          ).toISOString(),
          { platformConfig: args.platformConfig, email: userInfo.email },
        );
        const mismatch = getProfileUserMismatch(args, userInfo.email, userInfo.sub);
        if (mismatch) {
          writePlatformConfig(pfConfig);
          throw profileUserMismatchError(mismatch);
        }
        if (args.updateCurrentUser ?? true) {
          pfConfig.current_user = userInfo.sub;
        }
        await removeLegacyUserAlias(pfConfig, userInfo.email, userInfo.sub, args.platformConfig);
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
        reject(toError(error));
      } finally {
        // Close the server after handling one request.
        server.close();
      }
    };
    const server = http.createServer((req, res) => void handleCallback(req, res));

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

    const openBrowser = async (): Promise<void> => {
      logger.info(`Opening browser for login:\n\n${authorizeUri}\n`);
      try {
        await open(authorizeUri);
      } catch {
        logger.warn("Failed to open browser automatically. Please open the URL above manually.");
      }
    };
    server.listen(redirectPort, () => void openBrowser());
  });
};

async function loginAsMachineUser(
  args: { clientId: string; clientSecret?: string } & ProfileLoginOptions,
) {
  const clientSecret = args.clientSecret ?? (await prompt.password({ message: "Client secret" }));
  const tokens = await fetchPlatformMachineUserToken(
    args.clientId,
    clientSecret,
    args.platformConfig,
  );

  const pfConfig = await readPlatformConfig();
  await saveUserTokens(
    pfConfig,
    args.clientId,
    { accessToken: tokens.accessToken },
    new Date(assertDefined(tokens.expiresAt, "token response missing expiresAt")).toISOString(),
    { platformConfig: args.platformConfig },
  );
  const mismatch = getProfileUserMismatch(args, args.clientId);
  if (mismatch) {
    writePlatformConfig(pfConfig);
    throw profileUserMismatchError(mismatch);
  }
  if (args.updateCurrentUser ?? true) {
    pfConfig.current_user = args.clientId;
  }
  writePlatformConfig(pfConfig);
}

export const loginCommand = defineAppCommand({
  name: "login",
  description: "Login to Tailor Platform.",
  args: v.union([
    v.pipe(
      v.strictObject({
        profile: arg(v.optional(v.string()), {
          alias: "p",
          description: "Workspace profile whose platform settings should be used for login.",
          env: "TAILOR_PLATFORM_PROFILE",
        }),
      }),
      v.description("User Login"),
    ),
    v.pipe(
      v.strictObject({
        "machine-user": arg(v.literal(true), {
          description: "Login as a platform machine user.",
          required: true,
        }),
        "client-id": arg(v.string(), {
          description: "Client ID",
          env: "TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID",
          required: true,
        }),
        "client-secret": arg(v.optional(v.string()), {
          description: "Client secret",
          env: "TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET",
        }),
        profile: arg(v.optional(v.string()), {
          alias: "p",
          description: "Workspace profile whose platform settings should be used for login.",
          env: "TAILOR_PLATFORM_PROFILE",
        }),
      }),
      v.description("Machine User Login"),
    ),
  ]),
  run: async (args) => {
    try {
      let platformConfig: PlatformClientConfig | undefined;
      let profileUser: string | undefined;
      if ("profile" in args && args.profile) {
        const pfConfig = await readPlatformConfig();
        const profileEntry = pfConfig.profiles[args.profile];
        if (!profileEntry) {
          throw new Error(`Profile "${args.profile}" not found`);
        }
        platformConfig = platformConfigFromProfile(profileEntry);
        profileUser = profileEntry.user;
      }
      const updateCurrentUser = shouldUpdateCurrentUser(args.profile, platformConfig);
      if ("machine-user" in args) {
        await loginAsMachineUser({
          clientId: args.clientId,
          clientSecret: args.clientSecret,
          profile: args.profile,
          profileUser,
          platformConfig,
          updateCurrentUser,
          loginMode: "machine-user",
        });
      } else {
        await startAuthServer({
          profile: args.profile,
          profileUser,
          platformConfig,
          updateCurrentUser,
          loginMode: "user",
        });
      }
      logger.success("Successfully logged in to Tailor Platform.");
    } finally {
      await closeConnectionPool();
    }
  },
});
