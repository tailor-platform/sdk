import { arg } from "politty";
import { z } from "zod";
import { defaultPlatformBaseUrl, initOAuth2Client, isDefaultPlatform } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import {
  deleteUserTokens,
  hasAnyUserTokenEntry,
  hasUserTokenEntry,
  loadStoredUserTokens,
  platformConfigFromProfile,
  readPlatformConfig,
  writePlatformConfig,
} from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";

export const logoutCommand = defineAppCommand({
  name: "logout",
  description: "Logout from Tailor Platform.",
  args: z.strictObject({
    profile: arg(z.string().optional(), {
      alias: "p",
      description: "Workspace profile whose platform settings should be used for logout.",
      env: "TAILOR_PLATFORM_PROFILE",
    }),
  }),
  run: async (args) => {
    const profile = args.profile || process.env.TAILOR_PLATFORM_PROFILE;
    const pfConfig = await readPlatformConfig();
    const profileEntry = profile ? pfConfig.profiles[profile] : undefined;
    if (profile && !profileEntry) {
      throw new Error(`Profile "${profile}" not found`);
    }
    const platformConfig = profileEntry ? platformConfigFromProfile(profileEntry) : undefined;
    const currentUser = profileEntry ? profileEntry.user : pfConfig.current_user;
    const deletesDefaultToken = isDefaultPlatform(platformConfig);
    const lookupOptions = profile ? { allowLegacyUserKey: true } : undefined;
    if (!currentUser) {
      logger.info("You are not logged in.");
      return;
    }
    const hasDefaultUserToken = () =>
      hasUserTokenEntry(pfConfig, currentUser, { platformUrl: defaultPlatformBaseUrl });
    const shouldClearCurrentUser = () =>
      pfConfig.current_user === currentUser &&
      (deletesDefaultToken
        ? !hasDefaultUserToken()
        : !hasAnyUserTokenEntry(pfConfig, currentUser) && !hasDefaultUserToken());
    let storedTokens: Awaited<ReturnType<typeof loadStoredUserTokens>>;
    let tokenLoadFailed = false;
    try {
      storedTokens = await loadStoredUserTokens(
        pfConfig,
        currentUser,
        platformConfig,
        lookupOptions,
      );
    } catch (error) {
      tokenLoadFailed = true;
      logger.warn(`Failed to revoke token: ${error instanceof Error ? error.message : error}`);
    }
    if (!storedTokens && !tokenLoadFailed) {
      logger.info("You are not logged in.");
      if (shouldClearCurrentUser()) {
        pfConfig.current_user = null;
      }
      writePlatformConfig(pfConfig);
      return;
    }

    if (storedTokens) {
      try {
        const client = initOAuth2Client(platformConfig);
        const tokenTypeHint = storedTokens.refreshToken ? "refresh_token" : "access_token";
        await client.revoke(
          {
            accessToken: storedTokens.accessToken,
            refreshToken: storedTokens.refreshToken ?? null,
            expiresAt: Date.parse(storedTokens.userEntry.token_expires_at),
          },
          tokenTypeHint,
        );
      } catch (error) {
        logger.warn(`Failed to revoke token: ${error instanceof Error ? error.message : error}`);
      }
    }

    await deleteUserTokens(pfConfig, currentUser, platformConfig, lookupOptions);
    if (shouldClearCurrentUser()) {
      pfConfig.current_user = null;
    }
    writePlatformConfig(pfConfig);
    logger.success("Successfully logged out from Tailor Platform.");
  },
});
