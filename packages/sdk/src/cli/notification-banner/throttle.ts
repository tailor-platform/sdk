import * as fs from "node:fs";
import * as path from "pathe";
import { z } from "zod";

/** Minimum time between two banners, so a burst of commands shows it once. */
export const BANNER_INTERVAL_MS = 30 * 60 * 1000;

/** How long to wait after a failed lookup, so an outage does not cost a request per command. */
export const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

const bannerStateSchema = z.looseObject({
  version: z.literal(1),
  shownAt: z.iso.datetime().optional(),
  failedAt: z.iso.datetime().optional(),
  lastSeenIds: z.array(z.string()).default([]),
});

/** What the banner remembers between runs. */
export interface BannerState {
  version: 1;
  /** When the banner was last shown, or the inbox last found empty, as an ISO timestamp. */
  shownAt?: string | undefined;
  /** When the last lookup failed or went unanswered, as an ISO timestamp. */
  failedAt?: string | undefined;
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
  const { version, shownAt, failedAt, lastSeenIds } = result.data;
  return {
    version,
    ...(shownAt === undefined ? {} : { shownAt }),
    ...(failedAt === undefined ? {} : { failedAt }),
    lastSeenIds,
  };
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

function within(timestamp: string | undefined, now: number, interval: number): boolean {
  if (timestamp === undefined) return false;
  const elapsed = now - Date.parse(timestamp);
  return elapsed >= 0 && elapsed < interval;
}

/**
 * Whether to stay quiet: the banner was shown (or the inbox found empty) within
 * {@link BANNER_INTERVAL_MS}, or a lookup failed within {@link FAILURE_BACKOFF_MS}.
 * @param state - Last persisted state, if any
 * @param now - Current time in milliseconds since the epoch
 * @returns true while either interval has not elapsed
 */
export function isThrottled(state: BannerState | undefined, now: number): boolean {
  if (!state) return false;
  return (
    within(state.shownAt, now, BANNER_INTERVAL_MS) ||
    within(state.failedAt, now, FAILURE_BACKOFF_MS)
  );
}
