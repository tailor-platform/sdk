export const EXECUTION_POLICY_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
export const EXECUTION_POLICY_NAME_MESSAGE =
  "Invalid execution policy name: must match [a-z0-9-] (3-63 chars; must start and end with [a-z0-9])";

export const EXECUTION_POLICY_KEY_PATTERN = /^[a-z0-9][a-z0-9_:.-]{0,62}[a-z0-9*]$/;
export const EXECUTION_POLICY_KEY_MESSAGE =
  "Invalid execution policy key: must match [a-z0-9_:.-] (2-64 chars; must start with [a-z0-9] and end with [a-z0-9] or a trailing '*')";
export const EXECUTION_POLICY_KEY_WILDCARD_MESSAGE =
  "key must not end with '*'; omit the '*' and set matchType: \"prefix\" for wildcard policies (the SDK appends '*' automatically).";

/** Platform-facing execution policy key: the declared key plus `*` for prefix policies. */
export function toPlatformExecutionPolicyKey(key: string, matchType: "exact" | "prefix"): string {
  return matchType === "prefix" ? `${key}*` : key;
}

export const DURATION_UNITS = ["ms", "s", "m"] as const;

const UNIT_TO_SECONDS: Record<(typeof DURATION_UNITS)[number], number> = {
  ms: 1 / 1000,
  s: 1,
  m: 60,
};

/**
 * Convert a workflow duration string (`500ms`, `1s`, `1m`) to seconds.
 * @returns The duration in seconds, or null when the string is not a duration.
 */
export function durationToSeconds(duration: string): number | null {
  const match = /^(\d+)(ms|s|m)$/.exec(duration);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return parseInt(match[1], 10) * UNIT_TO_SECONDS[match[2] as (typeof DURATION_UNITS)[number]];
}

export const RETRY_POLICY_LIMITS = {
  maxRetries: { min: 1, max: 10 },
  initialBackoffMaxSeconds: 3600,
  maxBackoffMaxSeconds: 86400,
  backoffMultiplierMin: 1,
} as const;
