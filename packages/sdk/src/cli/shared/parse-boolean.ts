const TRUTHY_VALUES = new Set(["true", "t", "yes", "y", "on", "1"]);
const FALSY_VALUES = new Set(["false", "f", "no", "n", "off", "0"]);

/**
 * Parse a string value as a boolean.
 *
 * Recognized values (case-insensitive, trimmed) follow Python's
 * `distutils.util.strtobool` convention:
 * - truthy: `true, t, yes, y, on, 1`
 * - falsy: `false, f, no, n, off, 0`
 *
 * Undefined, empty strings, and unrecognized values return `undefined` so
 * that callers can fall back to their own defaults.
 * @param value - The input string (e.g. an environment variable or CLI flag value)
 * @returns `true`, `false`, or `undefined` when the value is unset or unrecognized
 */
export function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return undefined;
  if (TRUTHY_VALUES.has(normalized)) return true;
  if (FALSY_VALUES.has(normalized)) return false;
  return undefined;
}
