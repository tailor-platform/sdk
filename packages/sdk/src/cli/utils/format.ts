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

export function printData(data: object | object[], json: boolean = false) {
  if (json) {
    // eslint-disable-next-line no-restricted-syntax
    console.log(JSON.stringify(data));
    return;
  }

  if (!Array.isArray(data)) {
    process.stdout.write(
      formatKeyValueTable(Object.entries(data).map(([k, v]) => [k, formatValue(v)])),
    );
    return;
  }

  if (data.length === 0) {
    return;
  }

  const headers = Array.from(new Set(data.flatMap((item) => Object.keys(item))));

  const rows = data.map((item) =>
    headers.map((header) => {
      const value = (item as Record<string, unknown>)[header];
      if ((header === "createdAt" || header === "updatedAt") && typeof value === "string") {
        return humanizeRelativeTime(value);
      }
      return formatValue(value);
    }),
  );

  process.stdout.write(formatTableWithHeaders(headers, rows));
}
