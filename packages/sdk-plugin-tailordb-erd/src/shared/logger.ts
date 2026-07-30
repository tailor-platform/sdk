import { Stream } from "node:stream";
import { stripVTControlCharacters, styleText } from "node:util";

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

type StyleFormat = Parameters<typeof styleText>[0];

// Styling is always applied; renderFor drops it again when the destination
// stream has no color support.
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

function renderFor(stream: NodeJS.WriteStream, text: string): string {
  return supportsColor(stream) ? text : stripVTControlCharacters(text);
}

const gray = color("gray");

const TYPE_COLORS: Record<string, (text: string) => string> = {
  info: color("cyan"),
  success: color("green"),
  warn: color("yellow"),
  error: color("red"),
  log: (text) => text,
};

// In JSON mode, all logs go to stderr to keep stdout clean for JSON data
let _jsonMode = false;
let _verbose = false;

function writeLog(type: string, message: string, opts?: LogOptions): void {
  const mode = opts?.mode ?? "default";
  const colorFn = TYPE_COLORS[type] ?? ((text: string) => text);

  if (mode === "plain") {
    process.stderr.write(renderFor(process.stderr, `${colorFn(message)}\n`));
    return;
  }

  const icon = TYPE_ICONS[type] ?? "";
  const prefix = icon ? `${icon} ` : "";
  const timestamp = mode === "stream" ? `${new Date().toLocaleTimeString()} ` : "";
  process.stderr.write(
    renderFor(process.stderr, `${timestamp}${colorFn(`${prefix}${message}`)}\n`),
  );
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
      writeLog("log", gray(message), { mode: "plain" });
    }
  },

  out(data: string | object | object[]): void {
    if (typeof data === "string") {
      process.stdout.write(renderFor(process.stdout, data.endsWith("\n") ? data : `${data}\n`));
      return;
    }
    process.stdout.write(`${JSON.stringify(data)}\n`);
  },
};
