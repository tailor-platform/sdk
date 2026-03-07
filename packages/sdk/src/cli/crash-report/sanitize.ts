import * as os from "node:os";

const HOME_DIR = os.homedir();

// Patterns for sanitization
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX_PATTERN = /\b[0-9a-fA-F]{32,}\b/g;
const EMAIL_PATTERN = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const ABSOLUTE_PATH_PATTERN = /(?:\/(?:[\w.@-]+\/)+[\w.@-]+)/g;
const WINDOWS_PATH_PATTERN = /(?:[A-Za-z]:\\(?:[\w.@\- ]+\\)+[\w.@\- ]+)/g;
const URL_QUERY_PATTERN = /(\?|&)[^?\s]*/g;

// SDK package path marker for relative paths
const SDK_PACKAGE_MARKER = "packages/sdk/";

// Flags whose values should be redacted
const SENSITIVE_FLAGS = new Set([
  "--workspace-id",
  "-w",
  "--profile",
  "-p",
  "--profile-name",
  "--token",
  "--access-token",
  "--refresh-token",
  "--secret",
  "--password",
  "--api-key",
  "--organization-id",
  "--folder-id",
]);

/**
 * Sanitize a stack trace by replacing absolute paths with relative SDK paths.
 * External paths are replaced with `<external>/filename.ext`.
 * Home directories are replaced with `~/<redacted>/`.
 * @param stack - Raw stack trace string
 * @returns Sanitized stack trace
 */
export function sanitizeStackTrace(stack: string): string {
  let result = stack.replace(ABSOLUTE_PATH_PATTERN, (match) => {
    const sdkIndex = match.indexOf(SDK_PACKAGE_MARKER);
    if (sdkIndex !== -1) {
      return match.slice(sdkIndex);
    }

    if (match.startsWith(HOME_DIR)) {
      const basename = match.split("/").pop() ?? match;
      return `~/<redacted>/${basename}`;
    }

    const basename = match.split("/").pop() ?? match;
    return `<external>/${basename}`;
  });
  result = result.replace(WINDOWS_PATH_PATTERN, (match) => {
    const normalized = match.replace(/\\/g, "/");
    const sdkIndex = normalized.indexOf(SDK_PACKAGE_MARKER);
    if (sdkIndex !== -1) {
      return normalized.slice(sdkIndex);
    }
    const basename = match.split("\\").pop() ?? match;
    return `<external>/${basename}`;
  });
  return result;
}

/**
 * Sanitize an error message by redacting sensitive information.
 * Redacts: UUIDs, long hex tokens, email addresses, absolute paths, URL query strings.
 * @param message - Raw error message
 * @returns Sanitized error message
 */
export function sanitizeMessage(message: string): string {
  let result = message;
  result = result.replace(UUID_PATTERN, "<uuid>");
  result = result.replace(LONG_HEX_PATTERN, "<redacted>");
  result = result.replace(EMAIL_PATTERN, "<email>");
  result = result.replace(URL_QUERY_PATTERN, "?<redacted>");
  result = result.replace(ABSOLUTE_PATH_PATTERN, (match) => {
    const basename = match.split("/").pop() ?? match;
    return `<path>/${basename}`;
  });
  result = result.replace(WINDOWS_PATH_PATTERN, (match) => {
    const basename = match.split("\\").pop() ?? match;
    return `<path>/${basename}`;
  });
  return result;
}

/**
 * Sanitize process.argv by keeping command/subcommand names and redacting
 * values of sensitive flags.
 * @param argv - Raw process.argv array
 * @returns Sanitized argv array
 */
export function sanitizeArgv(argv: string[]): string[] {
  const result: string[] = [];
  let redactNext = false;

  for (const arg of argv) {
    if (redactNext) {
      result.push("<redacted>");
      redactNext = false;
      continue;
    }

    // Handle --flag=value format
    const eqIndex = arg.indexOf("=");
    if (eqIndex !== -1) {
      const flag = arg.slice(0, eqIndex);
      if (SENSITIVE_FLAGS.has(flag)) {
        result.push(`${flag}=<redacted>`);
        continue;
      }
    }

    // Handle --flag value format (next arg is the value)
    if (SENSITIVE_FLAGS.has(arg)) {
      result.push(arg);
      redactNext = true;
      continue;
    }

    // Redact things that look like absolute paths in arguments
    if (arg.startsWith("/") && arg.includes("/", 1)) {
      const basename = arg.split("/").pop() ?? arg;
      result.push(`<path>/${basename}`);
      continue;
    }

    // Redact Windows-style absolute paths (e.g., C:\Users\...)
    if (/^[A-Za-z]:\\/.test(arg)) {
      const basename = arg.split("\\").pop() ?? arg;
      result.push(`<path>/${basename}`);
      continue;
    }

    result.push(arg);
  }

  return result;
}
