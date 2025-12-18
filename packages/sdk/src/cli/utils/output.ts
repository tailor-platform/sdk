import { formatDistanceToNowStrict } from "date-fns";
import { getBorderCharacters, table } from "table";
import { styles, symbols } from "./logger";

/**
 * Output options for CLI commands
 */
export interface OutputOptions {
  json: boolean;
  quiet?: boolean;
}

/**
 * Output helper class for consistent CLI output
 */
export class Output {
  constructor(private options: OutputOptions) {}

  /**
   * Output data (respects --json flag)
   */
  data(data: object | object[]): void {
    if (this.options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    printTable(data);
  }

  /**
   * Output informational message (suppressed with --json or --quiet)
   */
  info(message: string): void {
    if (this.options.json || this.options.quiet) return;
    console.log(`${symbols.info} ${message}`);
  }

  /**
   * Output success message (suppressed with --json)
   */
  success(message: string): void {
    if (this.options.json) return;
    console.log(`${symbols.success} ${styles.success(message)}`);
  }

  /**
   * Output warning message (never suppressed)
   */
  warn(message: string): void {
    if (this.options.json) {
      console.error(JSON.stringify({ warning: message }));
    } else {
      console.log(`${symbols.warning} ${styles.warning(message)}`);
    }
  }

  /**
   * Output error message (never suppressed)
   */
  error(message: string): void {
    if (this.options.json) {
      console.error(JSON.stringify({ error: message }));
    } else {
      console.error(`${symbols.error} ${styles.error(message)}`);
    }
  }

  /**
   * Output progress message
   */
  progress(message: string): void {
    if (this.options.json || this.options.quiet) return;
    process.stdout.write(`\r${styles.dim("...")} ${message}`);
  }

  /**
   * Clear progress line
   */
  clearProgress(): void {
    if (this.options.json || this.options.quiet) return;
    process.stdout.write("\r\x1b[K");
  }
}

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
    console.log(JSON.stringify(data));
    return;
  }
  printTable(data);
}
