import { initOperatorClient } from "#/cli/shared/client";
import {
  fetchLatestToken,
  platformConfigFromProfile,
  readPlatformConfig,
} from "#/cli/shared/context";

type PlatformConfig = Awaited<ReturnType<typeof readPlatformConfig>>;

function resolvePatUser(config: PlatformConfig, activeProfile?: string): string | null {
  if (activeProfile) {
    return config.profiles[activeProfile]?.user ?? null;
  }
  return config.current_user;
}

export async function createPatOperatorClient(activeProfile?: string) {
  const config = await readPlatformConfig();
  const resolvedProfile = activeProfile || process.env.TAILOR_PLATFORM_PROFILE;
  const profileEntry = resolvedProfile ? config.profiles[resolvedProfile] : undefined;
  if (resolvedProfile && !profileEntry) {
    throw new Error(`Profile "${resolvedProfile}" not found`);
  }
  const platformConfig = profileEntry ? platformConfigFromProfile(profileEntry) : undefined;
  const user = resolvePatUser(config, resolvedProfile);

  if (!user) {
    throw new Error("No user logged in.\nPlease login first using 'tailor login' command.");
  }

  const { accessToken } = await fetchLatestToken(config, user, platformConfig);
  return await initOperatorClient(accessToken, platformConfig);
}
