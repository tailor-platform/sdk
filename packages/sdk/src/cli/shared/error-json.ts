import { Code, ConnectError } from "@connectrpc/connect";
import { isCLIError, typeOnlyImportHint, type CLIErrorNextAction } from "./errors";
import { redactSecrets } from "./logger";

/**
 * `JSON.stringify` replacer that redacts registered secrets from every string value it
 * walks — however deeply nested, since `error.context` is an arbitrary
 * `Record<string, unknown>` a secret could in principle reach through a nested value.
 * Passed as `JSON.stringify`'s second argument rather than pre-walking the envelope by
 * hand, so `JSON.stringify`'s own handling of circular references (throws, caught by the
 * existing fallback below) and `toJSON`-bearing values (e.g. `Date`, already converted to
 * its string form before this replacer sees it) both keep working unmodified.
 * @param _key - Property key being visited (unused)
 * @param value - Property value being visited
 * @returns `value`, redacted if it is a string
 */
function redactStringValues(_key: string, value: unknown): unknown {
  return typeof value === "string" ? redactSecrets(value) : value;
}

export interface ErrorToJsonOptions {
  /** Include the original stack trace in the error envelope. */
  includeStack?: boolean;
}

/**
 * Convert a CLI failure into the stable JSON error envelope.
 * @param error - Failure to serialize
 * @param options - JSON serialization options
 * @returns JSON-compatible error envelope
 */
export function errorToJson(
  error: unknown,
  options?: ErrorToJsonOptions,
): { error: Readonly<Record<string, unknown>> } {
  if (isCLIError(error)) {
    return {
      error: {
        code: error.code ?? "CLI_ERROR",
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        ...(error.suggestion ? { suggestion: error.suggestion } : {}),
        ...(error.command
          ? {
              help: executableHelpAction(error.command),
            }
          : {}),
        ...(error.next ? { next: error.next } : {}),
        ...(error.context ? { context: error.context } : {}),
        ...(options?.includeStack && error.stack ? { stack: error.stack } : {}),
      },
    };
  }
  if (error instanceof ConnectError) {
    const codeName = Code[error.code];
    const stableCode =
      typeof codeName === "string"
        ? codeName.replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()
        : `CODE_${error.code}`;
    return {
      error: {
        code: `RPC_${stableCode}`,
        message: error.message,
        ...(options?.includeStack && error.stack ? { stack: error.stack } : {}),
      },
    };
  }
  if (error instanceof Error) {
    const suggestion = typeOnlyImportHint(error);
    return {
      error: {
        code: error.name === "CIPromptError" ? "INTERACTIVE_PROMPT_REQUIRED" : "UNEXPECTED_ERROR",
        message: error.message,
        ...(suggestion ? { suggestion } : {}),
        ...(options?.includeStack && error.stack ? { stack: error.stack } : {}),
      },
    };
  }
  return { error: { code: "UNKNOWN_ERROR", message: String(error) } };
}

/**
 * Serialize a CLI failure into the stable JSON error envelope.
 *
 * Redacts registered secrets from every string in the envelope, however deeply nested,
 * before this function's own `JSON.stringify` call, rather than relying only on the
 * redaction `logger.log()` does on the final string: an upstream error message (or
 * `error.context`, an arbitrary record) can already embed a secret in JSON-escaped form
 * (e.g. echoed back inside a JSON API error body), and stringifying the envelope would
 * escape that a second time, no longer matching a registered secret's single-level-escaped
 * form.
 * @param error - Failure to serialize
 * @param options - JSON serialization options
 * @returns Serialized JSON error envelope
 */
export function serializeError(error: unknown, options?: ErrorToJsonOptions): string {
  const envelope = errorToJson(error, options);
  try {
    return JSON.stringify(envelope, redactStringValues);
  } catch {
    const fallbackError = { ...envelope.error };
    delete fallbackError.context;
    delete fallbackError.stack;
    return JSON.stringify({ error: fallbackError }, redactStringValues);
  }
}

function executableHelpAction(command: string): CLIErrorNextAction {
  return {
    command: "tailor",
    args: [...command.split(/\s+/).filter(Boolean), "--help"],
  };
}
