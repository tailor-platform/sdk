import { timestampDate } from "@bufbuild/protobuf/wkt";
import { formatDistanceToNowStrict } from "date-fns";
// eslint-disable-next-line no-restricted-imports
import { getBorderCharacters, table } from "table";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { TableUserConfig } from "table";

/**
 * Format a protobuf Timestamp to ISO string.
 * @param timestamp - Protobuf timestamp
 * @returns Date object or null if invalid
 */
export function formatTimestamp(timestamp: Timestamp | undefined): Date | null {
  if (!timestamp) {
    return null;
  }
  const date = timestampDate(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

/**
 * Formats a table with consistent single-line border style.
 * Use this instead of importing `table` directly.
 * @param data - Table data
 * @param config - Table configuration
 * @returns Formatted table string
 */
export function formatTable(data: unknown[][], config?: TableUserConfig): string {
  return table(data, {
    ...config,
    border: getBorderCharacters("norc"),
  });
}

/**
 * Formats a key-value table with single-line border style.
 * @param data - Key-value pairs
 * @returns Formatted key-value table string
 */
export function formatKeyValueTable(data: [string, string][]): string {
  return formatTable(data, { singleLine: true });
}

/**
 * Formats a table with headers, using single-line border style.
 * Draws horizontal lines only at top, after header, and bottom.
 * @param headers - Table header labels
 * @param rows - Table rows
 * @returns Formatted table string with headers
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
 * @param value - Value to format
 * @returns Human-readable string representation
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
 * Format a Date or ISO timestamp string as a human-readable relative time.
 * @param value - Date object, ISO date string, or null
 * @returns Relative time (e.g., "5 minutes ago") or "N/A" for null/invalid
 */
export function humanizeRelativeTime(value: Date | string | null): string {
  if (value === null) {
    return "N/A";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "N/A";
  }
  return formatDistanceToNowStrict(date, { addSuffix: true });
}
