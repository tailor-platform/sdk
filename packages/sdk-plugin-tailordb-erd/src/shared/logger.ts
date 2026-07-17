import chalk from "chalk";

export type LogMode = "default" | "stream" | "plain";

export interface LogOptions {
  /** Output mode (default: "default") */
  mode?: LogMode;
}

const TYPE_ICONS: Record<string, string> = {
  info: "ℹ",
  success: "✔",
  warn: "⚠",
  error: "✖",
  log: "",
};

const TYPE_COLORS: Record<string, (text: string) => string> = {
  info: chalk.cyan,
  success: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  log: (text) => text,
};

// In JSON mode, all logs go to stderr to keep stdout clean for JSON data
let _jsonMode = false;
let _verbose = false;

function writeLog(type: string, message: string, opts?: LogOptions): void {
  const mode = opts?.mode ?? "default";
  const colorFn = TYPE_COLORS[type] ?? ((text: string) => text);

  if (mode === "plain") {
    process.stderr.write(`${colorFn(message)}\n`);
    return;
  }

  const icon = TYPE_ICONS[type] ?? "";
  const prefix = icon ? `${icon} ` : "";
  const timestamp = mode === "stream" ? `${new Date().toLocaleTimeString()} ` : "";
  process.stderr.write(`${timestamp}${colorFn(`${prefix}${message}`)}\n`);
}

export const logger = {
  get jsonMode(): boolean {
    return _jsonMode;
  },
  set jsonMode(value: boolean) {
    _jsonMode = value;
  },

  get verbose(): boolean {
    return _verbose;
  },
  set verbose(value: boolean) {
    _verbose = value;
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
    if (_verbose) {
      writeLog("log", chalk.gray(message), { mode: "plain" });
    }
  },

  out(data: string | object | object[]): void {
    if (typeof data === "string") {
      process.stdout.write(data.endsWith("\n") ? data : `${data}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(data)}\n`);
  },
};
