export const infraFailurePatterns = [
  /Not logged in/i,
  /API key/i,
  /rate limit/i,
  /hit your (?:\w+ )?limit/i,
  /usage limit (?:reached|exceeded)/i,
  /quota (?:exceeded|exhausted)/i,
  /ETIMEDOUT/,
  /ECONNREFUSED/,
  /ECONNRESET/,
  /socket hang up/i,
  /authentication.*failed/i,
  /unauthorized/i,
  /403 Forbidden/i,
  /codex login/i,
];

export function detectInfraFailure(output: string): boolean {
  return infraFailurePatterns.some((pattern) => pattern.test(output));
}

// Subset of infra failures that are transient and worth retrying with a
// backoff. Auth / config errors are NOT in this list because re-running them
// without operator intervention burns budget without changing the outcome.
export const rateLimitPatterns = [
  /rate limit/i,
  /hit your (?:\w+ )?limit/i,
  /usage limit (?:reached|exceeded)/i,
  /quota (?:exceeded|exhausted)/i,
  /\b429\b/,
  /rate_limit_exceeded/i,
  /too\s*many\s*requests/i,
];

export function isRateLimitError(output: string): boolean {
  return rateLimitPatterns.some((pattern) => pattern.test(output));
}

/**
 * Parse a rate-limit reset hint from messages like
 * "You've hit your limit · resets 3:10pm (UTC)" or "resets at 15:10 UTC".
 * Returns the wall-clock ms timestamp of the reset, or null when no parseable
 * hint is found. Always interpreted as UTC; the source messages from Claude
 * Code today always emit UTC suffixes.
 */
export function extractRateLimitResetMs(output: string, now: Date = new Date()): number | null {
  const match = output.match(/resets\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i);
  if (!match) return null;
  const hourRaw = Number.parseInt(match[1] ?? "", 10);
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0;
  const ampm = match[3]?.toLowerCase();
  if (!Number.isFinite(hourRaw) || !Number.isFinite(minute)) return null;
  let hour = hourRaw;
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  // Build the target as today UTC; if it has already passed, roll to tomorrow.
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0),
  );
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime();
}
