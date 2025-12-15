import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInMonths,
  differenceInYears,
} from "date-fns";
import { getBorderCharacters, table } from "table";

export function humanizeRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  const now = new Date();

  const minutes = differenceInMinutes(now, date);
  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    const unit = minutes === 1 ? "minute" : "minutes";
    return `${minutes} ${unit} ago`;
  }

  const hours = differenceInHours(now, date);
  if (hours < 24) {
    const unit = hours === 1 ? "hour" : "hours";
    return `${hours} ${unit} ago`;
  }

  const days = differenceInDays(now, date);
  if (days < 30) {
    const unit = days === 1 ? "day" : "days";
    return `${days} ${unit} ago`;
  }

  const months = differenceInMonths(now, date);
  if (months < 12) {
    const unit = months === 1 ? "month" : "months";
    return `${months} ${unit} ago`;
  }

  const years = differenceInYears(now, date);
  const unit = years === 1 ? "year" : "years";
  return `${years} ${unit} ago`;
}

export function printData(data: object | object[], json: boolean = false) {
  if (json) {
    console.log(JSON.stringify(data));
    return;
  }

  if (Array.isArray(data)) {
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
}
