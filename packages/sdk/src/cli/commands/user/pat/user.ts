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
  const profileEntry = activeProfile ? config.profiles[activeProfile] : undefined;
  if (activeProfile && !profileEntry) {
    throw new Error(`Profile "${activeProfile}" not found`);
  }
  const platformConfig = profileEntry ? platformConfigFromProfile(profileEntry) : undefined;
  const user = resolvePatUser(config, activeProfile);

  if (!user) {
    throw new Error("No user logged in.\nPlease login first using 'tailor login' command.");
  }

  const { accessToken } = await fetchLatestToken(config, user, platformConfig);
  return await initOperatorClient(accessToken, platformConfig);
}
