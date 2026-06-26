import { initOperatorClient } from "#/cli/shared/client";
import {
  fetchLatestToken,
  loadPlatformClientConfig,
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
  const platformConfig = await loadPlatformClientConfig();
  const config = await readPlatformConfig();
  const user = resolvePatUser(config);

  if (!user) {
    throw new Error("No user logged in.\nPlease login first using 'tailor-sdk login' command.");
  }

  const token = await fetchLatestToken(config, user, platformConfig);
  return await initOperatorClient(token, platformConfig);
}
