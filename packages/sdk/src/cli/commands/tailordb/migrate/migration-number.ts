/**
 * Format migration number as 4-digit string.
 * @param num - Migration number
 * @returns 4-digit padded string
 */
export function formatMigrationNumber(num: number): string {
  return num.toString().padStart(4, "0");
}
