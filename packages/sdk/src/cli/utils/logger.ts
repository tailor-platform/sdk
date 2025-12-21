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

// Mode-specific consola instances
const defaultLogger = createConsola({
  formatOptions: { date: false },
});

const streamLogger = createConsola({
  formatOptions: { date: true },
});

const plainLogger = createConsola({
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
