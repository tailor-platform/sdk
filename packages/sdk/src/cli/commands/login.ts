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
  isDefaultPlatform,
  normalizeBaseUrl,
  type PlatformClientConfig,
} from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import {
  platformConfigFromProfile,
  readPlatformConfig,
  saveUserTokens,
  writePlatformConfig,
} from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { assertDefined } from "#/utils/assert";

const redirectPort = 8085;
const redirectUri = `http://localhost:${redirectPort}/callback`;
type ProfileLoginOptions = {
  profile?: string;
  profileUser?: string;
  platformConfig?: PlatformClientConfig;
  updateCurrentUser?: boolean;
};
type ProfileUserUpdate = {
  profile: string;
  oldUser: string;
  newUser: string;
};

function randomState() {
  return crypto.randomBytes(32).toString("base64url");
}

function profileUserMismatchMessage(update: ProfileUserUpdate) {
  return `Profile "${update.profile}" is configured for "${update.oldUser}", but login authenticated "${update.newUser}".`;
}

function getProfileUserUpdate(
  args: ProfileLoginOptions,
  authenticatedUser: string,
): ProfileUserUpdate | undefined {
  if (!args.profile || !args.profileUser || authenticatedUser === args.profileUser) {
    return undefined;
  }
  return { profile: args.profile, oldUser: args.profileUser, newUser: authenticatedUser };
}

function storedPlatformScope(profile: Parameters<typeof platformConfigFromProfile>[0]) {
  const platformUrl = platformConfigFromProfile(profile)?.platformUrl;
  return platformUrl ? normalizeBaseUrl(platformUrl) : undefined;
}

async function confirmProfileUserUpdate(
  args: ProfileLoginOptions,
  authenticatedUser: string,
): Promise<ProfileUserUpdate | undefined> {
  const update = getProfileUserUpdate(args, authenticatedUser);
  if (!update) return undefined;

  const accepted = await prompt.confirm({
    message: `${profileUserMismatchMessage(update)} Update this profile to use "${update.newUser}"?`,
    default: false,
  });
  if (!accepted) {
    throw new Error(profileUserMismatchMessage(update));
  }
  return update;
}

async function applyProfileUserUpdate(
  config: Awaited<ReturnType<typeof readPlatformConfig>>,
  update: ProfileUserUpdate,
) {
  const profileEntry = config.profiles[update.profile];
  if (!profileEntry) {
    throw new Error(`Profile "${update.profile}" not found`);
  }
  const profilePlatformScope = storedPlatformScope(profileEntry);
  const otherProfiles = Object.entries(config.profiles).filter(
    ([name, profile]) =>
      name !== update.profile &&
      profile?.user === update.oldUser &&
      storedPlatformScope(profile) === profilePlatformScope,
  );
  profileEntry.user = update.newUser;
  if (otherProfiles.length === 0) return;

  const profileLabel = otherProfiles.length === 1 ? "profile" : "profiles";
  const accepted = await prompt.confirm({
    message: `Update ${otherProfiles.length} other ${profileLabel} configured for "${update.oldUser}" to use "${update.newUser}"?`,
    default: false,
  });
  if (!accepted) return;

  for (const [, profile] of otherProfiles) {
    if (profile) {
      profile.user = update.newUser;
    }
  }
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
        const userInfo = await fetchUserInfo(tokens.accessToken, args.platformConfig);
        const profileUserUpdate = await confirmProfileUserUpdate(args, userInfo.email);

        const pfConfig = await readPlatformConfig();
        await saveUserTokens(
          pfConfig,
          userInfo.email,
          {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken ?? undefined,
          },
          new Date(
            assertDefined(tokens.expiresAt, "token response missing expiresAt"),
          ).toISOString(),
          args.platformConfig,
        );
        if (profileUserUpdate) {
          await applyProfileUserUpdate(pfConfig, profileUserUpdate);
        }
        if (args.updateCurrentUser ?? true) {
          pfConfig.current_user = userInfo.email;
        }
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

async function loginAsMachineUser(
  args: { clientId: string; clientSecret?: string } & ProfileLoginOptions,
) {
  const profileUserUpdate = await confirmProfileUserUpdate(args, args.clientId);
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
    args.platformConfig,
  );
  if (profileUserUpdate) {
    await applyProfileUserUpdate(pfConfig, profileUserUpdate);
  }
  if (args.updateCurrentUser ?? true) {
    pfConfig.current_user = args.clientId;
  }
  writePlatformConfig(pfConfig);
}

export const loginCommand = defineAppCommand({
  name: "login",
  description: "Login to Tailor Platform.",
  args: z.xor([
    z
      .object({
        profile: arg(z.string().optional(), {
          alias: "p",
          description: "Workspace profile whose platform settings should be used for login.",
          env: "TAILOR_PLATFORM_PROFILE",
        }),
      })
      .strict()
      .describe("User Login"),
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
        profile: arg(z.string().optional(), {
          alias: "p",
          description: "Workspace profile whose platform settings should be used for login.",
          env: "TAILOR_PLATFORM_PROFILE",
        }),
      })
      .strict()
      .describe("Machine User Login"),
  ]),
  run: async (args) => {
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
      });
    } else {
      await startAuthServer({
        profile: args.profile,
        profileUser,
        platformConfig,
        updateCurrentUser,
      });
    }
    logger.success("Successfully logged in to Tailor Platform.");
    await closeConnectionPool();
  },
});
