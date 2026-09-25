const POSITIVE_INT_PATTERN = /^\d*[1-9]\d*$/;

/**
 * Parse a string value as a positive integer.
 *
 * Only decimal digits are accepted (leading zeros allowed), so `0`, negative
 * numbers, decimals, exponent notation, and signed values are all rejected.
 * Values above `Number.MAX_SAFE_INTEGER` are rejected too: past that point the
 * parsed number no longer represents the digits it came from, so it cannot
 * describe a meaningful limit.
 *
 * Undefined, empty strings, and unrecognized values return `undefined` so
 * that callers can fall back to their own defaults.
 * @param value - The input string (e.g. an environment variable or CLI flag value)
 * @returns The parsed integer, or `undefined` when the value is unset or unrecognized
 */
export function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!POSITIVE_INT_PATTERN.test(normalized)) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
