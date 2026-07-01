import { initOperatorClient } from "#/cli/shared/client";
import {
  fetchLatestToken,
  platformConfigFromProfile,
  readPlatformConfig,
} from "#/cli/shared/context";

type PlatformConfig = Awaited<ReturnType<typeof readPlatformConfig>>;

export function resolvePatUser(config: PlatformConfig): string | null {
  const activeProfile = process.env.TAILOR_PLATFORM_PROFILE;
  if (activeProfile) {
    return config.profiles[activeProfile]?.user ?? null;
  }
  return config.current_user;
}

export async function createPatOperatorClient() {
  const config = await readPlatformConfig();
  const activeProfile = process.env.TAILOR_PLATFORM_PROFILE;
  const profileEntry = activeProfile ? config.profiles[activeProfile] : undefined;
  if (activeProfile && !profileEntry) {
    throw new Error(`Profile "${activeProfile}" not found`);
  }
  const platformConfig = profileEntry ? platformConfigFromProfile(profileEntry) : undefined;
  const user = resolvePatUser(config);

  if (!user) {
    throw new Error("No user logged in.\nPlease login first using 'tailor login' command.");
  }

  const { accessToken: token } = await fetchLatestToken(config, user, platformConfig);
  return await initOperatorClient(token, platformConfig);
}
