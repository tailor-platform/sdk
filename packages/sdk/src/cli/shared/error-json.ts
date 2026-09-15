import { Code, ConnectError } from "@connectrpc/connect";
import { getErrorDiagnostics } from "./error-diagnostics";
import { isCLIError, typeOnlyImportHint, type CLIErrorNextAction } from "./errors";
import { redactSecrets } from "./logger";
import type { Jsonifiable } from "type-fest";

/**
 * `JSON.stringify` replacer that redacts registered secrets from every string value it
 * walks, and from any value that `JSON.stringify` would otherwise emit as a bare
 * (unquoted) token — a number, boolean, or `null` — however deeply nested, since
 * `error.context` is an arbitrary `Record<string, unknown>` a secret could in principle
 * reach through a nested value. Passed as `JSON.stringify`'s second argument rather than
 * pre-walking the envelope by hand, so `JSON.stringify`'s own handling of circular
 * references (throws, caught by the existing fallback below) and `toJSON`-bearing values
 * (e.g. `Date`, already converted to its string form before this replacer sees it) both
 * keep working unmodified.
 *
 * A bare-token value is redacted through its `JSON.stringify`d form (e.g. `1234567890`,
 * `"true"`, `"null"`), matching a registered secret that happens to equal that same text
 * (e.g. a numeric PIN, or — degenerate but possible, since it only needs to clear the
 * 4-character minimum — a secret literally equal to `"true"`/`"false"`/`"null"`).
 * Returning the redacted string in place of the original value keeps `JSON.stringify`
 * quoting it correctly, so the envelope stays valid JSON even where the outer,
 * structure-unaware `redactSecrets()` pass `logger.log()` applies later would otherwise
 * turn a bare matching token into an unquoted `<redacted>`.
 * @param _key - Property key being visited (unused)
 * @param value - Property value being visited
 * @returns `value`, redacted if it is a string, number, boolean, or `null`
 */
function redactStringValues(_key: string, value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    const text = JSON.stringify(value);
    const redacted = redactSecrets(text);
    return redacted === text ? value : redacted;
  }
  return value;
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
): { error: Readonly<Record<string, Jsonifiable | undefined>> } {
  const envelope = baseErrorToJson(error, options);
  if (!(error instanceof Error)) return envelope;
  // `location` drives source annotations for tooling, not the error envelope.
  const { causes, context, location: _location, ...diagnostics } = getErrorDiagnostics(error);
  return {
    error: {
      ...envelope.error,
      ...diagnostics,
      ...(context || causes
        ? {
            context: {
              ...context,
              ...Object.fromEntries(
                Object.entries(causes ?? {}).map(([phase, cause]) => [
                  phase,
                  errorToJson(cause, options).error,
                ]),
              ),
            },
          }
        : {}),
    },
  };
}

function baseErrorToJson(
  error: unknown,
  options?: ErrorToJsonOptions,
): { error: Readonly<Record<string, Jsonifiable | undefined>> } {
  if (isCLIError(error)) {
    return {
      error: {
        code: error.code || "CLI_ERROR",
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
 * Redacts registered secrets from every string, number, boolean, and `null` *value* in the
 * envelope, however deeply nested, before this function's own `JSON.stringify` call, rather
 * than relying only on the redaction `logger.log()` does on the final string: an upstream
 * error message (or `error.context`, an arbitrary record) can already embed a secret in
 * JSON-escaped form (e.g. echoed back inside a JSON API error body), and stringifying the
 * envelope would escape that a second time, no longer matching a registered secret's
 * single-level-escaped form. Redacting non-string bare tokens here also matters because the
 * later, structure-unaware `redactSecrets()` pass over the fully rendered JSON text cannot
 * tell a bare token apart from a JSON string, so a secret whose value coincides with an
 * unrelated number/boolean/`null` elsewhere in the envelope would otherwise become an
 * unquoted `<redacted>` and break the output as JSON.
 *
 * Does not cover a secret used as an object *key* (e.g. `context: { [secret]: true }`) —
 * `JSON.stringify`'s replacer can only transform values, never rename keys. No current
 * caller does this (`context` keys are always fixed, SDK-chosen strings), and the CLI's own
 * `logger.log(serializeError(...))` call site is still protected regardless, since that
 * redaction pass re-scans the fully rendered JSON text and does not distinguish key
 * position from value position.
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
