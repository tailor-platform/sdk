import { formatDistanceToNowStrict } from "date-fns";
// eslint-disable-next-line no-restricted-imports
import { getBorderCharacters, table } from "table";
import type { TableUserConfig } from "table";

/**
 * Formats a table with consistent single-line border style.
 * Use this instead of importing `table` directly.
 * @param {unknown[][]} data - Table data
 * @param {TableUserConfig} [config] - Table configuration
 * @returns {string} Formatted table string
 */
export function formatTable(data: unknown[][], config?: TableUserConfig): string {
  return table(data, {
    ...config,
    border: getBorderCharacters("norc"),
  });
}

/**
 * Formats a key-value table with single-line border style.
 * @param {[string, string][]} data - Key-value pairs
 * @returns {string} Formatted key-value table string
 */
export function formatKeyValueTable(data: [string, string][]): string {
  return formatTable(data, { singleLine: true });
}

/**
 * Formats a table with headers, using single-line border style.
 * Draws horizontal lines only at top, after header, and bottom.
 * @param {string[]} headers - Table header labels
 * @param {string[][]} rows - Table rows
 * @returns {string} Formatted table string with headers
 */
export function formatTableWithHeaders(headers: string[], rows: string[][]): string {
  return formatTable([headers, ...rows], {
    drawHorizontalLine: (lineIndex, rowCount) => {
      return lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount;
    },
  });
}

/**
 * Format a 2D array of values into a table string.
 * @param {unknown} value - Value to format
 * @returns {string} Human-readable string representation
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(String).join("\n");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

/**
 * Format an ISO timestamp string as a human-readable relative time.
 * @param {string} isoString - ISO date string
 * @returns {string} Relative time (e.g., "5 minutes ago")
 */
export function humanizeRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  return formatDistanceToNowStrict(date, { addSuffix: true });
}
