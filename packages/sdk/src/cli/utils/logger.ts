import { formatWithOptions, type InspectOptions } from "node:util";
import chalk from "chalk";
import { createConsola, type PromptOptions } from "consola";
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

    const timestamp =
      formatOptions.date && logObj.date ? `${logObj.date.toLocaleTimeString()} ` : "";
    stderr.write(`${timestamp}${prefix}${message}\n`);
  }
}

class PlainReporter {
  log(
    logObj: { type: string; tag?: string; args: unknown[]; level: number },
    ctx: {
      options: { stderr?: NodeJS.WriteStream; formatOptions: object };
    },
  ) {
    const stderr = ctx.options.stderr || process.stderr;
    const formatOptions = ctx.options.formatOptions as { compact?: boolean | number };
    const inspectOpts: InspectOptions = {
      breakLength: 100,
      compact: formatOptions.compact,
    };
    const message = formatWithOptions(inspectOpts, ...logObj.args);
    stderr.write(`${message}\n`);
  }
}

const defaultLogger = createConsola({
  reporters: [new IconReporter()],
  formatOptions: { date: false },
});

const streamLogger = createConsola({
  reporters: [new IconReporter()],
  formatOptions: { date: true },
});

const plainLogger = createConsola({
  reporters: [new PlainReporter()],
  formatOptions: { date: false, compact: true },
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

  success(message: string, opts?: LogOptions): void {
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

  warn(message: string, opts?: LogOptions): void {
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

  log(message: string): void {
    plainLogger.log(message);
  },

  newline(): void {
    plainLogger.log("");
  },

  debug(message: string): void {
    plainLogger.log(styles.dim(message));
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
          return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
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
