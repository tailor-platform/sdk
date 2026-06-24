/**
 * Format migration number as 4-digit string.
 * @param num - Migration number
 * @returns 4-digit padded string
 */
export function formatMigrationNumber(num: number): string {
  return num.toString().padStart(4, "0");
}

/**
 * Parse a migration number CLI argument.
 *
 * Accepts the canonical 4-digit form ("0001") or a bare integer without
 * leading zeros ("0"–"9999"). Commands that disallow the baseline reject
 * 0 themselves with a context-specific message.
 * @param numberStr - Raw CLI argument
 * @returns Parsed migration number
 */
export function parseMigrationNumberArg(numberStr: string): number {
  if (/^\d{4}$/.test(numberStr)) {
    return parseInt(numberStr, 10);
  }
  if (/^(0|[1-9]\d*)$/.test(numberStr)) {
    const parsed = parseInt(numberStr, 10);
    if (parsed > 9999) {
      throw new Error(`Migration number ${numberStr} is out of range. Expected 0-9999.`);
    }
    return parsed;
  }
  throw new Error(
    `Invalid migration number format: ${numberStr}. Expected 4-digit format (e.g., 0001) or integer 0-9999 (e.g., 1).`,
  );
}
