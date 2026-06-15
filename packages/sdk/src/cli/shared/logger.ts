import { formatWithOptions, type InspectOptions } from "node:util";
import chalk from "chalk";
import { formatDistanceToNowStrict } from "date-fns";
import { getBorderCharacters, table } from "table";
import { parseBoolean } from "./parse-boolean";

/**
 * Error thrown when a prompt is attempted in a CI environment
 */
export class CIPromptError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "Interactive prompts are not available in CI environments. Use --yes flag to skip confirmation prompts.",
    );
    this.name = "CIPromptError";
  }
}

/**
 * Semantic style functions for inline text styling
 */
export const styles = {
  // Status colors
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.cyan,

  // Action colors (for change sets)
  create: chalk.green,
  update: chalk.yellow,
  delete: chalk.red,
  unchanged: chalk.gray,

  // Emphasis
  bold: chalk.bold,
  dim: chalk.gray,
  highlight: chalk.cyanBright,
  successBright: chalk.greenBright,
  errorBright: chalk.redBright,

  // Resource types
  resourceType: chalk.bold,
  resourceName: chalk.cyan,

  // File paths
  path: chalk.cyan,

  // Values
  value: chalk.white,
  placeholder: chalk.gray.italic,
};

/**
 * Standardized symbols for CLI output
 */
export const symbols = {
  success: chalk.green("\u2713"),
  error: chalk.red("\u2716"),
  warning: chalk.yellow("\u26a0"),
  info: chalk.cyan("i"),
  create: chalk.green("+"),
  update: chalk.yellow("~"),
  delete: chalk.red("-"),
  replace: chalk.magenta("\u00b1"),
  bullet: chalk.gray("\u2022"),
  arrow: chalk.gray("\u2192"),
};

/**
 * Log output modes
 */
export type LogMode = "default" | "stream" | "plain";

export interface LogOptions {
  /** Output mode (default: "default") */
  mode?: LogMode;
  /** Number of spaces to indent the entire line (default: 0) */
  indent?: number;
}

/** Field transformer function. null excludes the field from table output. */
export type FieldTransformer = ((value: unknown, item: object) => string) | null;

export interface OutOptions {
  /** Table display field transform/exclude settings. Only applied in table mode (not JSON). */
  display?: Record<string, FieldTransformer>;

  /** Show null values in table output (default: false) */
  showNull?: boolean;
}

// In JSON mode, all logs go to stderr to keep stdout clean for JSON data
let _jsonMode = false;

// Type icons for log output
const TYPE_ICONS: Record<string, string> = {
  info: "ℹ",
  success: "✔",
  warn: "⚠",
  error: "✖",
  debug: "⚙",
  trace: "→",
  log: "",
};

// Color functions for icon and message text
const TYPE_COLORS: Record<string, (text: string) => string> = {
  info: chalk.cyan,
  success: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  debug: chalk.gray,
  trace: chalk.gray,
  log: (text) => text,
};

interface FormatLogLineOptions {
  mode: string;
  indent: number;
  type: string;
  message: string;
  timestamp?: string;
}

/**
 * Formats a log line with the appropriate prefix and indentation
 * @param opts - Formatting options
 * @returns Formatted log line
 */
export function formatLogLine(opts: FormatLogLineOptions): string {
  const { mode, indent, type, message, timestamp } = opts;
  const indentPrefix = indent > 0 ? " ".repeat(indent) : "";
  // index access may be undefined without noUncheckedIndexedAccess
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  const colorFn = TYPE_COLORS[type] || ((text: string) => text);

  // Plain mode: color only, no icon, no timestamp
  if (mode === "plain") {
    return `${indentPrefix}${colorFn(message)}\n`;
  }

  // Default/Stream mode: with icon and color
  const icon = TYPE_ICONS[type] || "";
  const prefix = icon ? `${icon} ` : "";
  const coloredOutput = colorFn(`${prefix}${message}`);
  const timestampPrefix = timestamp ?? "";

  return `${indentPrefix}${timestampPrefix}${coloredOutput}\n`;
}

/**
 * Writes a formatted log line to stderr.
 * @param type - Log type (info, success, warn, error, log)
 * @param message - Log message
 * @param opts - Log options (mode and indent)
 */
function writeLog(type: string, message: string, opts?: LogOptions): void {
  const mode = opts?.mode ?? "default";
  const indent = opts?.indent ?? 0;
  const inspectOpts: InspectOptions = {
    breakLength: process.stdout.columns || 80,
  };
  const formattedMessage = formatWithOptions(inspectOpts, message);
  const timestamp = mode === "stream" ? `${new Date().toLocaleTimeString()} ` : "";
  const output = formatLogLine({ mode, indent, type, message: formattedMessage, timestamp });
  process.stderr.write(output);
}

export const logger = {
  get jsonMode(): boolean {
    return _jsonMode;
  },
  set jsonMode(value: boolean) {
    _jsonMode = value;
  },

  info(message: string, opts?: LogOptions): void {
    writeLog("info", message, opts);
  },

  success(message: string, opts?: LogOptions): void {
    writeLog("success", message, opts);
  },

  warn(message: string, opts?: LogOptions): void {
    writeLog("warn", message, opts);
  },

  error(message: string, opts?: LogOptions): void {
    writeLog("error", message, opts);
  },

  log(message: string): void {
    writeLog("log", message, { mode: "plain" });
  },

  newline(): void {
    process.stderr.write("\n");
  },

  debug(message: string): void {
    if (parseBoolean(process.env.DEBUG) === true) {
      writeLog("log", styles.dim(message), { mode: "plain" });
    }
  },

  out(data: string | object | object[], options?: OutOptions): void {
    if (typeof data === "string") {
      process.stdout.write(data.endsWith("\n") ? data : data + "\n");
      return;
    }

    if (this.jsonMode) {
      // eslint-disable-next-line no-restricted-syntax
      console.log(JSON.stringify(data));
      return;
    }

    const display = options?.display;

    // Helper to format a value for table display
    const formatValue = (value: unknown, pretty = false): string => {
      if (options?.showNull && value === null) return "NULL";
      if (value === null || value === undefined) return "N/A";
      if (value instanceof Date) {
        return formatDistanceToNowStrict(value, { addSuffix: true });
      }
      if (typeof value === "object") {
        return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
      }
      return String(value);
    };

    // Helper to check if field should be excluded
    const isExcluded = (key: string): boolean => {
      return display !== undefined && key in display && display[key] === null;
    };

    // Helper to apply transformer or default formatting
    const transformValue = (key: string, value: unknown, item: object, pretty = false): string => {
      if (display && key in display) {
        const transformer = display[key];
        if (transformer) {
          return transformer(value, item);
        }
      }
      return formatValue(value, pretty);
    };

    if (!Array.isArray(data)) {
      const entries = Object.entries(data).filter(([key]) => !isExcluded(key));
      const formattedEntries = entries.map(([key, value]) => [
        key,
        transformValue(key, value, data, true),
      ]);
      const t = table(formattedEntries, {
        singleLine: false,
        border: getBorderCharacters("norc"),
      });
      process.stdout.write(t);
      return;
    }

    if (data.length === 0) {
      return;
    }

    const allHeaders = Array.from(new Set(data.flatMap((item) => Object.keys(item))));
    const headers = allHeaders.filter((h) => !isExcluded(h));
    const rows = data.map((item) =>
      headers.map((header) =>
        transformValue(header, (item as Record<string, unknown>)[header], item),
      ),
    );

    const t = table([headers, ...rows], {
      border: getBorderCharacters("norc"),
      drawHorizontalLine: (lineIndex, rowCount) => {
        return lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount;
      },
    });
    process.stdout.write(t);
  },
};
