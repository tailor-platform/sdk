import * as crypto from "node:crypto";
import * as os from "node:os";
import { sanitizeArgv, sanitizeMessage, sanitizeStackTrace } from "./sanitize";

export type CrashType = "uncaughtException" | "unhandledRejection" | "handledError";

export interface CrashReport {
  id: string;
  timestamp: string;
  sdkVersion: string;
  nodeVersion: string;
  osPlatform: string;
  osRelease: string;
  arch: string;
  command: string;
  argv: string[];
  errorName: string;
  errorMessage: string;
  stackTrace: string;
  crashType: CrashType;
}

interface BuildCrashReportOptions {
  error: unknown;
  sdkVersion: string;
  crashType: CrashType;
}

// Maximum subcommand depth to keep (e.g., "workspace create" = 2 tokens).
// Positional arguments beyond this are potentially sensitive user input.
const MAX_COMMAND_TOKENS = 2;

/**
 * Parse the command name from process.argv.
 * Extracts up to MAX_COMMAND_TOKENS non-flag arguments after the script name.
 * @returns Parsed command string
 */
function parseCommand(): string {
  const args = process.argv.slice(2);
  const commandParts: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("-")) break;
    if (commandParts.length >= MAX_COMMAND_TOKENS) break;
    commandParts.push(arg);
  }
  return commandParts.join(" ") || "<unknown>";
}

/**
 * Build a CrashReport data structure from an error and context.
 * All sensitive data is sanitized before inclusion.
 * @param options - Error, SDK version, and crash type
 * @returns Sanitized crash report
 */
export function buildCrashReport(options: BuildCrashReportOptions): CrashReport {
  const { error, sdkVersion, crashType } = options;

  const isError = error instanceof Error;
  const rawMessage = isError ? error.message : String(error);
  const rawStack = isError && error.stack ? error.stack : "";
  const errorName = isError ? error.name : "UnknownError";

  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sdkVersion,
    nodeVersion: process.version,
    osPlatform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    command: sanitizeMessage(parseCommand()),
    argv: sanitizeArgv(process.argv),
    errorName,
    errorMessage: sanitizeMessage(rawMessage),
    stackTrace: sanitizeStackTrace(rawStack),
    crashType,
  };
}
