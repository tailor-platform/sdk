import { formatDistanceToNowStrict } from "date-fns";
import { getBorderCharacters, table } from "table";
import { logger } from "./logger";

/**
 * Format ISO timestamp to relative time
 */
export function humanizeRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

/**
 * Print data as a formatted table or JSON
 */
export function printTable(data: object | object[]): void {
  if (!Array.isArray(data)) {
    const t = table(Object.entries(data), {
      singleLine: true,
      border: getBorderCharacters("norc"),
    });
    process.stdout.write(t);
    return;
  }

  if (data.length === 0) {
    return;
  }

  const headers = Array.from(
    new Set(data.flatMap((item) => Object.keys(item))),
  );

  const rows = data.map((item) =>
    headers.map((header) => {
      const value = (item as Record<string, unknown>)[header];
      if (value === null || value === undefined) {
        return "";
      }
      if (
        (header === "createdAt" || header === "updatedAt") &&
        typeof value === "string"
      ) {
        return humanizeRelativeTime(value);
      }
      return String(value);
    }),
  );

  const t = table([headers, ...rows], {
    border: getBorderCharacters("norc"),
    drawHorizontalLine: (lineIndex, rowCount) => {
      return lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount;
    },
  });
  process.stdout.write(t);
}

/**
 * Print data as JSON or table based on the json flag
 */
export function printData(data: object | object[], json: boolean = false) {
  if (json) {
    logger.log(JSON.stringify(data));
    return;
  }
  printTable(data);
}
