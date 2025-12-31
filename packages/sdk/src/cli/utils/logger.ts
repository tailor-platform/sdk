import { formatWithOptions, type InspectOptions } from "node:util";
import chalk from "chalk";
import { createConsola, type PromptOptions } from "consola";
import { isCI } from "std-env";

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

// Type icons matching consola's FancyReporter
const TYPE_ICONS: Record<string, string> = {
  info: "ℹ",
  success: "✔",
  warn: "⚠",
  error: "✖",
  debug: "⚙",
  trace: "→",
  log: "",
};

/**
 * Custom reporter that outputs messages without extra newlines that FancyReporter adds
 * but still includes type icons for info/success/warn/error
 */
class IconReporter {
  log(
    logObj: { type: string; tag?: string; args: unknown[]; level: number; date?: Date },
    ctx: {
      options: {
        stdout?: NodeJS.WriteStream;
        stderr?: NodeJS.WriteStream;
        formatOptions: { date?: boolean; compact?: boolean | number };
      };
    },
  ) {
    const stdout = ctx.options.stdout || process.stdout;
    const stderr = ctx.options.stderr || process.stderr;
    const formatOptions = ctx.options.formatOptions;
    const inspectOpts: InspectOptions = {
      breakLength: stdout.columns || 80,
      compact: formatOptions.compact,
    };
    const message = formatWithOptions(inspectOpts, ...logObj.args);
    const icon = TYPE_ICONS[logObj.type] || "";
    const prefix = icon ? `${icon} ` : "";

    // Add timestamp if date option is enabled
    const timestamp =
      formatOptions.date && logObj.date ? `${logObj.date.toLocaleTimeString()} ` : "";

    const stream = logObj.level < 2 ? stderr : stdout;
    stream.write(`${timestamp}${prefix}${message}\n`);
  }
}

/**
 * Custom reporter that outputs messages without type prefix brackets
 * and without extra newlines that FancyReporter adds
 */
class PlainReporter {
  log(
    logObj: { type: string; tag?: string; args: unknown[]; level: number },
    ctx: {
      options: { stdout?: NodeJS.WriteStream; stderr?: NodeJS.WriteStream; formatOptions: object };
    },
  ) {
    const stdout = ctx.options.stdout || process.stdout;
    const stderr = ctx.options.stderr || process.stderr;
    const formatOptions = ctx.options.formatOptions as { compact?: boolean | number };
    const inspectOpts: InspectOptions = {
      breakLength: 100,
      compact: formatOptions.compact,
    };
    const message = formatWithOptions(inspectOpts, ...logObj.args);
    const stream = logObj.level < 2 ? stderr : stdout;
    stream.write(`${message}\n`);
  }
}

// Mode-specific consola instances with custom reporters to avoid extra newlines
const defaultLogger = createConsola({
  reporters: [new IconReporter()],
  formatOptions: { date: false },
});

const streamLogger = createConsola({
  reporters: [new IconReporter()],
  formatOptions: { date: true },
});

// Use custom PlainReporter to avoid [log] prefix and extra newlines
const plainLogger = createConsola({
  reporters: [new PlainReporter()],
  formatOptions: { date: false, compact: true },
});

/**
 * Logger object for CLI output
 */
export const logger = {
  /**
   * JSON mode flag
   * When enabled, most log output is suppressed
   */
  jsonMode: false,

  /**
   * Log informational message (suppressed in JSON mode)
   */
  info(message: string, opts?: LogOptions): void {
    if (this.jsonMode) return;
    const mode = opts?.mode ?? "default";

    switch (mode) {
      case "stream":
        streamLogger.info(message);
        break;
      case "plain":
        plainLogger.log(message);
        break;
      default:
        defaultLogger.info(message);
    }
  },

  /**
   * Log success message (suppressed in JSON mode)
   */
  success(message: string, opts?: LogOptions): void {
    if (this.jsonMode) return;
    const mode = opts?.mode ?? "default";

    switch (mode) {
      case "stream":
        streamLogger.success(message);
        break;
      case "plain":
        plainLogger.log(styles.success(message));
        break;
      default:
        defaultLogger.success(message);
    }
  },

  /**
   * Log warning message (suppressed in JSON mode)
   */
  warn(message: string, opts?: LogOptions): void {
    if (this.jsonMode) return;
    const mode = opts?.mode ?? "default";

    switch (mode) {
      case "stream":
        streamLogger.warn(message);
        break;
      case "plain":
        plainLogger.log(styles.warning(message));
        break;
      default:
        defaultLogger.warn(message);
    }
  },

  /**
   * Log error message (always shown, even in JSON mode)
   */
  error(message: string, opts?: LogOptions): void {
    const mode = opts?.mode ?? "default";

    switch (mode) {
      case "stream":
        streamLogger.error(message);
        break;
      case "plain":
        plainLogger.error(styles.error(message));
        break;
      default:
        defaultLogger.error(message);
    }
  },

  /**
   * Log raw message without prefix (suppressed in JSON mode)
   */
  log(message: string): void {
    if (this.jsonMode) return;
    plainLogger.log(message);
  },

  /**
   * Log empty line (suppressed in JSON mode)
   */
  newline(): void {
    if (this.jsonMode) return;
    plainLogger.log("");
  },

  /**
   * Log debug message (suppressed in JSON mode)
   * Uses dim color for less emphasis
   */
  debug(message: string): void {
    if (this.jsonMode) return;
    plainLogger.log(styles.dim(message));
  },

  /**
   * Output data - JSON in JSON mode, otherwise formatted
   */
  data(dataValue: unknown, formatFn?: (d: unknown) => void): void {
    if (this.jsonMode) {
      plainLogger.log(JSON.stringify(dataValue, null, 2));
    } else if (formatFn) {
      formatFn(dataValue);
    } else {
      plainLogger.log(String(dataValue));
    }
  },

  /**
   * Interactive prompt (always shown, even in JSON mode)
   * Wraps consola.prompt for consistent interface
   *
   * @throws {CIPromptError} When called in a CI environment
   */
  prompt<T extends PromptOptions>(
    message: string,
    options?: T,
  ): ReturnType<typeof defaultLogger.prompt<T>> {
    if (isCI) {
      throw new CIPromptError();
    }
    return defaultLogger.prompt(message, options);
  },
};
