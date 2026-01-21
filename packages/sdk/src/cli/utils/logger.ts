import { formatWithOptions, type InspectOptions } from "node:util";
import chalk from "chalk";
import {
  createConsola,
  type ConsolaOptions,
  type ConsolaReporter,
  type LogObject,
  type PromptOptions,
} from "consola";
import { formatDistanceToNowStrict } from "date-fns";
import { isCI } from "std-env";
import { getBorderCharacters, table } from "table";

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

/**
 * Reporter that handles all log output modes.
 *
 * Supports three modes controlled via logObj.tag:
 * - "default": Colored icons and messages, no timestamp, dynamic line wrapping
 * - "stream": Colored icons with timestamps, for streaming/polling operations
 * - "plain": Colored messages only, no icons, no timestamp
 */
class Reporter implements ConsolaReporter {
  log(logObj: LogObject, ctx: { options: ConsolaOptions }) {
    const mode = (logObj.tag as string) || "default";
    const stdout = ctx.options.stdout || process.stdout;
    const stderr = ctx.options.stderr || process.stderr;
    const formatOptions = ctx.options.formatOptions;
    const inspectOpts: InspectOptions = {
      breakLength: stdout.columns || 80,
      compact: formatOptions.compact,
    };
    const message = formatWithOptions(inspectOpts, ...logObj.args);

    // Apply color based on log type
    const colorFn = TYPE_COLORS[logObj.type] || ((text) => text);

    // Plain mode: color only, no icon, no timestamp
    if (mode === "plain") {
      stderr.write(`${colorFn(message)}\n`);
      return;
    }

    // Default/Stream mode: with icon and color
    const icon = TYPE_ICONS[logObj.type] || "";
    const prefix = icon ? `${icon} ` : "";
    const coloredOutput = colorFn(`${prefix}${message}`);

    // Add timestamp for stream mode
    const timestamp =
      mode === "stream" && logObj.date ? `${logObj.date.toLocaleTimeString()} ` : "";
    stderr.write(`${timestamp}${coloredOutput}\n`);
  }
}

const consola = createConsola({
  reporters: [new Reporter()],
  formatOptions: { date: true },
});

export const logger = {
  get jsonMode(): boolean {
    return _jsonMode;
  },
  set jsonMode(value: boolean) {
    _jsonMode = value;
  },

  info(message: string, opts?: LogOptions): void {
    const mode = opts?.mode ?? "default";
    consola.withTag(mode).info(message);
  },

  success(message: string, opts?: LogOptions): void {
    const mode = opts?.mode ?? "default";
    consola.withTag(mode).success(message);
  },

  warn(message: string, opts?: LogOptions): void {
    const mode = opts?.mode ?? "default";
    consola.withTag(mode).warn(message);
  },

  error(message: string, opts?: LogOptions): void {
    const mode = opts?.mode ?? "default";
    consola.withTag(mode).error(message);
  },

  log(message: string): void {
    consola.withTag("plain").log(message);
  },

  newline(): void {
    consola.withTag("plain").log("");
  },

  debug(message: string): void {
    if (process.env.DEBUG === "true") {
      consola.withTag("plain").log(styles.dim(message));
    }
  },

  out(data: string | object | object[]): void {
    if (typeof data === "string") {
      process.stdout.write(data.endsWith("\n") ? data : data + "\n");
      return;
    }

    if (this.jsonMode) {
      // eslint-disable-next-line no-restricted-syntax
      console.log(JSON.stringify(data));
      return;
    }

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

    const headers = Array.from(new Set(data.flatMap((item) => Object.keys(item))));
    const rows = data.map((item) =>
      headers.map((header) => {
        const value = (item as Record<string, unknown>)[header];
        if (value === null || value === undefined) {
          return "";
        }
        if ((header === "createdAt" || header === "updatedAt") && typeof value === "string") {
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) {
            return value;
          }
          return formatDistanceToNowStrict(date, { addSuffix: true });
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
  },

  /**
   * Prompt the user for input unless running in CI.
   * @template T
   * @param message - Prompt message
   * @param options - Prompt options
   * @throws {CIPromptError} When called in a CI environment
   * @returns Prompt result
   */
  prompt<T extends PromptOptions>(
    message: string,
    options?: T,
  ): ReturnType<typeof consola.prompt<T>> {
    if (isCI) {
      throw new CIPromptError();
    }
    return consola.prompt(message, options);
  },
};
