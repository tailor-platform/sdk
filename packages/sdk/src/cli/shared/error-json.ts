import { Code, ConnectError } from "@connectrpc/connect";
import { getErrorDiagnostics } from "./error-diagnostics";
import { isCLIError, locatedMessage, typeOnlyImportHint, type CLIErrorNextAction } from "./errors";
import { plainRedacted, redactSecrets } from "./logger";
import type { Jsonifiable } from "type-fest";

/**
 * `JSON.stringify` replacer that redacts registered secrets from every string value it
 * walks, and from any value that `JSON.stringify` would otherwise emit as a bare
 * (unquoted) token — a number, boolean, or `null` — however deeply nested, since
 * `error.context` is an arbitrary `Record<string, unknown>` a secret could in principle
 * reach through a nested value. Passed as `JSON.stringify`'s second argument rather than
 * pre-walking the envelope by hand, so `JSON.stringify`'s own handling of circular
 * references (throws, caught by the fallback in `errorToJson`) and `toJSON`-bearing values
 * (e.g. `Date`, already converted to its string form before this replacer sees it) both
 * keep working unmodified. Object keys pass through unredacted.
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
 * @returns `value`, redacted if it is a string, number, boolean, or `null`, and without colors if it is a string
 */
function redactStringValues(_key: string, value: unknown): unknown {
  if (typeof value === "string") return plainRedacted(value);
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

type ErrorEnvelope = { error: Readonly<Record<string, Jsonifiable | undefined>> };

/**
 * Convert a CLI failure into the stable JSON error envelope.
 *
 * String values come without colors, and registered secrets are redacted from every value.
 * The envelope holds only what JSON can represent: a `Date` becomes its ISO string, and when
 * the context cannot be written as JSON, for example because it is circular, the envelope
 * leaves out `context` and `stack`.
 * @param error - Failure to serialize
 * @param options - JSON serialization options
 * @returns JSON-compatible error envelope
 */
export function errorToJson(error: unknown, options?: ErrorToJsonOptions): ErrorEnvelope {
  const envelope = buildErrorEnvelope(error, options);
  try {
    return plainRedactedCopy(envelope);
  } catch {
    const { context: _context, stack: _stack, ...rest } = envelope.error;
    return plainRedactedCopy({ error: rest });
  }
}

function plainRedactedCopy(envelope: ErrorEnvelope): ErrorEnvelope {
  return JSON.parse(JSON.stringify(envelope, redactStringValues)) as ErrorEnvelope;
}

function buildErrorEnvelope(error: unknown, options?: ErrorToJsonOptions): ErrorEnvelope {
  const envelope = baseErrorEnvelope(error, options);
  if (!(error instanceof Error)) return envelope;
  // `location` is rendered into `message`, not carried as its own field.
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

function baseErrorEnvelope(error: unknown, options?: ErrorToJsonOptions): ErrorEnvelope {
  if (isCLIError(error)) {
    return {
      error: {
        code: error.code || "CLI_ERROR",
        message: locatedMessage(error),
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
        message: locatedMessage(error),
        ...(options?.includeStack && error.stack ? { stack: error.stack } : {}),
      },
    };
  }
  if (error instanceof Error) {
    const suggestion = typeOnlyImportHint(error);
    return {
      error: {
        code: error.name === "CIPromptError" ? "INTERACTIVE_PROMPT_REQUIRED" : "UNEXPECTED_ERROR",
        message: locatedMessage(error),
        ...(suggestion ? { suggestion } : {}),
        ...(options?.includeStack && error.stack ? { stack: error.stack } : {}),
      },
    };
  }
  return { error: { code: "UNKNOWN_ERROR", message: String(error) } };
}

/**
 * Serialize a CLI failure into the stable JSON error envelope that `errorToJson` returns.
 * @param error - Failure to serialize
 * @param options - JSON serialization options
 * @returns Serialized JSON error envelope
 */
export function serializeError(error: unknown, options?: ErrorToJsonOptions): string {
  return JSON.stringify(errorToJson(error, options));
}

function executableHelpAction(command: string): CLIErrorNextAction {
  return {
    command: "tailor",
    args: [...command.split(/\s+/).filter(Boolean), "--help"],
  };
}
