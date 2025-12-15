import humanizeDuration from "humanize-duration";
import { getBorderCharacters, table } from "table";

export type OutputFormat = "table" | "json";

export function parseFormat(jsonFlag?: boolean): OutputFormat {
  return jsonFlag ? "json" : "table";
}

export function humanizeRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  const diffMs = Date.now() - date.getTime();

  if (diffMs <= 0) {
    return "just now";
  }

  const humanized = humanizeDuration(diffMs, {
    largest: 1,
    round: true,
  });

  return `${humanized} ago`;
}

export function printWithFormat(
  data: object | object[],
  format: OutputFormat,
): void {
  switch (format) {
    case "table": {
      if (Array.isArray(data)) {
        if (data.length === 0) {
          break;
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
            // 0: top border, 1: after header row, rowCount: bottom border
            return lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount;
          },
        });
        process.stdout.write(t);
      } else {
        const t = table(Object.entries(data), {
          singleLine: true,
          border: getBorderCharacters("norc"),
        });
        process.stdout.write(t);
      }
      break;
    }
    case "json":
      console.log(JSON.stringify(data));
      break;
    default:
      throw new Error(`Format "${format satisfies never}" is invalid.`);
  }
}
