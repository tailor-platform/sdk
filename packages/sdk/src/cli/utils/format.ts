import { formatDistanceToNowStrict } from "date-fns";
// eslint-disable-next-line no-restricted-imports
import { getBorderCharacters, table } from "table";
import type { TableUserConfig } from "table";

/**
 * Formats a table with consistent single-line border style.
 * Use this instead of importing `table` directly.
 */
export function formatTable(data: unknown[][], config?: TableUserConfig): string {
  return table(data, {
    ...config,
    border: getBorderCharacters("norc"),
  });
}

/**
 * Formats a key-value table with single-line border style.
 */
export function formatKeyValueTable(data: [string, string][]): string {
  return formatTable(data, { singleLine: true });
}

/**
 * Formats a table with headers, using single-line border style.
 * Draws horizontal lines only at top, after header, and bottom.
 */
export function formatTableWithHeaders(headers: string[], rows: string[][]): string {
  return formatTable([headers, ...rows], {
    drawHorizontalLine: (lineIndex, rowCount) => {
      return lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount;
    },
  });
}

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

export function humanizeRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  return formatDistanceToNowStrict(date, { addSuffix: true });
}
