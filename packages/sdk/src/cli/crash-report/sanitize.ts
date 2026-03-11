import * as os from "node:os";

const HOME_DIR = os.homedir();

// Patterns for sanitization (global variants for use with .replace())
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX_PATTERN = /\b[0-9a-fA-F]{32,}\b/g;
const EMAIL_PATTERN = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const ABSOLUTE_PATH_PATTERN = /(?:\/(?:[\w.@\- ]+\/)+[\w.@\- ]+)/g;
const WINDOWS_PATH_PATTERN = /(?:[A-Za-z]:\\(?:[\w.@\- ]+\\)+[\w.@\- ]+)/g;
const URL_QUERY_PATTERN = /[?&][^?\s]*/g;

// Non-global variants for single-match .test() calls (avoids lastIndex state issues)
const EMAIL_TEST_PATTERN = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/;
const WINDOWS_DRIVE_TEST_PATTERN = /^[A-Za-z]:\\/;

// SDK package path marker for relative paths
const SDK_PACKAGE_MARKER = "packages/sdk/";

function lastSegment(filePath: string, separator: string): string {
  return filePath.split(separator).pop() ?? filePath;
}

/**
 * Sanitize a stack trace by replacing absolute paths with relative SDK paths.
 * External paths are replaced with `<external>/filename.ext`.
 * Home directories are replaced with `~/<redacted>/`.
 * @param stack - Raw stack trace string
 * @returns Sanitized stack trace
 */
export function sanitizeStackTrace(stack: string): string {
  // V8 stack traces start with "ErrorType: message\n    at ...".
  // The error message may span multiple lines before the first "    at " frame.
  // Apply message sanitization to all message lines so secrets embedded in
  // multiline error messages are redacted consistently with errorMessage.
  const firstFrameIndex = stack.search(/\n\s+at /);
  let result: string;
  if (firstFrameIndex !== -1) {
    result = sanitizeMessage(stack.slice(0, firstFrameIndex)) + stack.slice(firstFrameIndex);
  } else {
    result = sanitizeMessage(stack);
  }

  result = result.replace(ABSOLUTE_PATH_PATTERN, (match) => {
    const sdkIndex = match.indexOf(SDK_PACKAGE_MARKER);
    if (sdkIndex !== -1) {
      return match.slice(sdkIndex);
    }

    if (match.startsWith(HOME_DIR)) {
      return `~/<redacted>/${lastSegment(match, "/")}`;
    }

    return `<external>/${lastSegment(match, "/")}`;
  });
  result = result.replace(WINDOWS_PATH_PATTERN, (match) => {
    const normalized = match.replace(/\\/g, "/");
    const sdkIndex = normalized.indexOf(SDK_PACKAGE_MARKER);
    if (sdkIndex !== -1) {
      return normalized.slice(sdkIndex);
    }
    return `<external>/${lastSegment(match, "\\")}`;
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
  // Strip serialized request/response bodies that may contain secrets
  result = result.replace(/\nRequest:\s*[\s\S]*$/, "\nRequest: <redacted>");
  result = result.replace(UUID_PATTERN, "<uuid>");
  result = result.replace(LONG_HEX_PATTERN, "<redacted>");
  result = result.replace(EMAIL_PATTERN, "<email>");
  result = result.replace(URL_QUERY_PATTERN, "?<redacted>");
  result = result.replace(ABSOLUTE_PATH_PATTERN, (match) => `<path>/${lastSegment(match, "/")}`);
  result = result.replace(WINDOWS_PATH_PATTERN, (match) => `<path>/${lastSegment(match, "\\")}`);

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
      // If the next token is itself a flag, treat it as a new flag rather
      // than consuming it as the previous flag's value. This avoids leaking
      // the *next* flag's value (e.g., `--verbose --workspace-id secret`
      // would otherwise expose `secret`).
      if (!arg.startsWith("-")) {
        result.push("<redacted>");
        redactNext = false;
        continue;
      }
      redactNext = false;
    }

    if (arg.startsWith("-")) {
      // --flag=value: keep flag name, redact value
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        result.push(`${arg.slice(0, eqIndex)}=<redacted>`);
        continue;
      }

      // --flag / -f: keep flag name, redact next arg as its value
      result.push(arg);
      redactNext = true;
      continue;
    }

    // Redact absolute paths
    if (arg.startsWith("/") && arg.includes("/", 1)) {
      result.push("<path>");
      continue;
    }

    // Redact Windows-style absolute paths
    if (WINDOWS_DRIVE_TEST_PATTERN.test(arg)) {
      result.push("<path>");
      continue;
    }

    // Redact email addresses
    if (EMAIL_TEST_PATTERN.test(arg)) {
      result.push("<email>");
      continue;
    }

    result.push(arg);
  }

  return result;
}
