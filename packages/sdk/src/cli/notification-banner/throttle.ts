import * as fs from "node:fs";
import * as path from "pathe";
import { z } from "zod";

/** Minimum time between two banners, so a burst of commands shows it once. */
export const BANNER_INTERVAL_MS = 30 * 60 * 1000;

const bannerStateSchema = z.looseObject({
  version: z.literal(1),
  shownAt: z.iso.datetime(),
  lastSeenIds: z.array(z.string()).default([]),
});

/** What the banner remembers between runs. */
export interface BannerState {
  version: 1;
  /** When the banner was last shown, or the inbox last found empty, as an ISO timestamp. */
  shownAt: string;
  /** Ids shown last time, reserved for a "new since last time" highlight. */
  lastSeenIds: string[];
}

/**
 * Where the banner state file lives: next to the platform config.
 * @param configDir - XDG config directory (`xdgConfig` from `xdg-basedir` for the current user)
 * @returns File path, or undefined when the user has no config directory
 */
export function getBannerStatePath(configDir: string | undefined): string | undefined {
  if (!configDir) return undefined;
  return path.join(configDir, "tailor-platform", "notification-banner.json");
}

/**
 * Read the banner state file.
 * @param file - Path from {@link getBannerStatePath}
 * @returns The state, or undefined when the file is missing or not valid state
 */
export function readBannerState(file: string): BannerState | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = bannerStateSchema.safeParse(parsed);
  if (!result.success) return undefined;
  const { version, shownAt, lastSeenIds } = result.data;
  return { version, shownAt, lastSeenIds };
}

/**
 * Write the banner state file atomically, creating its directory.
 * @param file - Path from {@link getBannerStatePath}
 * @param state - State to persist
 */
export function writeBannerState(file: string, state: BannerState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state) + "\n");
  fs.renameSync(tmp, file);
}

/**
 * Whether the banner was shown recently enough to stay quiet.
 * @param state - Last persisted state, if any
 * @param now - Current time in milliseconds since the epoch
 * @returns true while the interval since `shownAt` has not elapsed
 */
export function isThrottled(state: BannerState | undefined, now: number): boolean {
  if (!state) return false;
  const elapsed = now - Date.parse(state.shownAt);
  return elapsed >= 0 && elapsed < BANNER_INTERVAL_MS;
}
