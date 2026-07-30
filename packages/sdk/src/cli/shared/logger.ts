import { Stream } from "node:stream";
import {
  formatWithOptions,
  type InspectOptions,
  stripVTControlCharacters,
  styleText,
} from "node:util";
import { formatDistanceToNowStrict } from "date-fns";
import { renderTable } from "./ascii-table";
import { parseBoolean } from "./parse-boolean";

/**
 * Error thrown when a prompt is attempted in a non-interactive environment
 */
export class CIPromptError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "Interactive prompts are not available in this environment. Provide the required options explicitly.",
    );
    this.name = "CIPromptError";
  }
}

type StyleFormat = Parameters<typeof styleText>[0];

/**
 * Creates a style function. Styling is always applied; `renderFor` drops it again
 * when the destination stream has no color support.
 * @param format - Style name, or names to combine
 * @returns Style function for the given format
 */
const color =
  (format: StyleFormat) =>
  (text: string): string =>
    styleText(format, text, { validateStream: false });

// Ask styleText whether the destination gets colors, so the TTY / NO_COLOR /
// FORCE_COLOR rules stay Node's rather than being reimplemented here. styleText
// returns the text unchanged for streams without color support, and rejects
// values that are not streams at all, such as test doubles.
const PROBE = "?";
const supportsColor = (stream: NodeJS.WriteStream): boolean =>
  stream instanceof Stream && styleText("red", PROBE, { stream }) !== PROBE;

/**
 * Prepares styled text for the stream it is written to.
 * @param stream - Stream the text is written to
 * @param text - Styled text
 * @returns Text with styling removed when the stream has no color support
 */
export function renderFor(stream: NodeJS.WriteStream, text: string): string {
  return supportsColor(stream) ? text : stripVTControlCharacters(text);
}

/**
 * Semantic style functions for inline text styling
 */
export const styles = {
  // Status colors
  success: color("green"),
  error: color("red"),
  warning: color("yellow"),
  info: color("cyan"),

  // Action colors (for change sets)
  create: color("green"),
  update: color("yellow"),
  delete: color("red"),
  replace: color("magenta"),
  unchanged: color("gray"),

  // Emphasis
  bold: color("bold"),
  dim: color("gray"),
  highlight: color("cyanBright"),
  successBright: color("greenBright"),
  errorBright: color("redBright"),

  // Resource types
  resourceType: color("bold"),
  resourceName: color("cyan"),

  // File paths
  path: color("cyan"),

  // Values
  value: color("white"),
  placeholder: color(["gray", "italic"]),
};

/**
 * Standardized symbols for CLI output
 */
export const symbols = {
  success: styles.success("\u2713"),
  error: styles.error("\u2716"),
  warning: styles.warning("\u26a0"),
  info: styles.info("i"),
  create: styles.create("+"),
  update: styles.update("~"),
  delete: styles.delete("-"),
  replace: styles.replace("\u00b1"),
  bullet: styles.dim("\u2022"),
  arrow: styles.dim("\u2192"),
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
  info: styles.info,
  success: styles.success,
  warn: styles.warning,
  error: styles.error,
  debug: styles.dim,
  trace: styles.dim,
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
  process.stderr.write(renderFor(process.stderr, output));
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
      process.stdout.write(renderFor(process.stdout, data.endsWith("\n") ? data : data + "\n"));
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
      const t = renderTable(formattedEntries, { singleLine: false });
      process.stdout.write(renderFor(process.stdout, t));
      return;
    }

    if (data.length === 0) {
      return;
    }

    const allHeaders = Array.from(new Set(data.flatMap((item) => Object.keys(item))));
    const headers = allHeaders.filter((h) => !isExcluded(h));
    if (headers.length === 0) {
      return;
    }
    const rows = data.map((item) =>
      headers.map((header) =>
        transformValue(header, (item as Record<string, unknown>)[header], item),
      ),
    );

    const t = renderTable([headers, ...rows], {
      drawHorizontalLine: (lineIndex, rowCount) => {
        return lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount;
      },
    });
    process.stdout.write(renderFor(process.stdout, t));
  },
};
