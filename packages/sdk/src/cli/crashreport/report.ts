import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import { parseYAML } from "confbox";
import * as path from "pathe";
import { xdgConfig } from "xdg-basedir";
import { sanitizeArgv, sanitizeMessage, sanitizeStackTrace } from "./sanitize";

export type ErrorType = "uncaughtException" | "unhandledRejection" | "handledError";

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
  errorType: ErrorType;
  userId: string | null;
  userEmail: string | null;
}

interface BuildCrashReportOptions {
  error: unknown;
  sdkVersion: string;
  errorType: ErrorType;
}

// Maximum subcommand depth to keep (e.g., "tailordb migrate generate" = 3 tokens).
// Positional arguments beyond this are potentially sensitive user input.
// Accepted trade-off: plain-text positional args that don't match known patterns
// (UUIDs, hex tokens, emails, paths) pass through to `command` and `argv`.
// Full redaction would require embedding the CLI command tree here, which is fragile.
const MAX_COMMAND_TOKENS = 3;

/**
 * Parse the command name from process.argv.
 * Extracts up to MAX_COMMAND_TOKENS non-flag arguments after the script name.
 * @returns Parsed command string
 */
function parseCommand(): string {
  const args = process.argv.slice(2);
  const commandParts: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("-") || commandParts.length >= MAX_COMMAND_TOKENS) break;
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
  const { error, sdkVersion, errorType } = options;

  const isError = error instanceof Error;
  const rawMessage = isError ? error.message : String(error);
  const rawStack = isError && error.stack ? error.stack : "";
  const errorName = isError ? error.name : "UnknownError";

  const currentUser = readCurrentUser();

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
    errorType,
    userId: currentUser,
    userEmail: currentUser,
  };
}

/**
 * Read current_user from Tailor Platform config without side effects.
 * Unlike readPlatformConfig(), this never triggers migration or logs warnings.
 * @returns The current user email, or null if unavailable
 */
function readCurrentUser(): string | null {
  try {
    if (!xdgConfig) return null;
    const configPath = path.join(xdgConfig, "tailor-platform", "config.yaml");
    if (!fs.existsSync(configPath)) return null;
    const raw = parseYAML(fs.readFileSync(configPath, "utf-8")) as { current_user?: string | null };
    return raw.current_user ?? null;
  } catch {
    return null;
  }
}
