import type { readPlatformConfig } from "#/cli/shared/context";

type PlatformConfig = Awaited<ReturnType<typeof readPlatformConfig>>;

export function resolvePatUser(config: PlatformConfig): string | null {
  const activeProfile = process.env.TAILOR_PLATFORM_PROFILE;
  if (activeProfile) {
    return config.profiles[activeProfile]?.user ?? null;
  }
  return config.current_user;
}
