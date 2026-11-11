import * as fs from "node:fs";
import * as path from "pathe";
import { z } from "zod";

/** How long to wait after a failed lookup, so an outage does not cost a request per command. */
export const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

const bannerStateSchema = z.looseObject({
  version: z.literal(1),
  failedAt: z.iso.datetime().optional(),
});

/** What the banner remembers between runs. */
export interface BannerState {
  version: 1;
  /** When the last lookup failed or went unanswered, as an ISO timestamp. */
  failedAt?: string | undefined;
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
  const { version, failedAt } = result.data;
  return { version, ...(failedAt === undefined ? {} : { failedAt }) };
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
 * Whether a lookup failed within {@link FAILURE_BACKOFF_MS}, so this run should not send another.
 * @param state - Last persisted state, if any
 * @param now - Current time in milliseconds since the epoch
 * @returns true while the backoff has not elapsed
 */
export function inFailureBackoff(state: BannerState | undefined, now: number): boolean {
  if (state?.failedAt === undefined) return false;
  const elapsed = now - Date.parse(state.failedAt);
  return elapsed >= 0 && elapsed < FAILURE_BACKOFF_MS;
}
