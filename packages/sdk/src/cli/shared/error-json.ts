import { Code, ConnectError } from "@connectrpc/connect";
import { isCLIError, typeOnlyImportHint, type CLIErrorNextAction } from "./errors";
import { redactSecrets } from "./logger";

// Free-text envelope fields that can carry a registered secret.
const REDACTABLE_ENVELOPE_FIELDS = ["message", "details", "suggestion", "stack"] as const;

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
 * Redacts registered secrets from the envelope's free-text fields before this function's
 * own `JSON.stringify` call, rather than relying only on the redaction `logger.log()` does
 * on the final string: an upstream error message can already embed a secret in JSON-escaped
 * form (e.g. echoed back inside a JSON API error body), and stringifying the envelope would
 * escape that a second time, no longer matching a registered secret's single-level-escaped
 * form.
 * @param error - Failure to serialize
 * @param options - JSON serialization options
 * @returns Serialized JSON error envelope
 */
export function serializeError(error: unknown, options?: ErrorToJsonOptions): string {
  const envelope = errorToJson(error, options);
  const redactedError = { ...envelope.error };
  for (const field of REDACTABLE_ENVELOPE_FIELDS) {
    const value = redactedError[field];
    if (typeof value === "string") redactedError[field] = redactSecrets(value);
  }
  try {
    return JSON.stringify({ error: redactedError });
  } catch {
    const fallbackError = { ...redactedError };
    delete fallbackError.context;
    delete fallbackError.stack;
    return JSON.stringify({ error: fallbackError });
  }
}

function executableHelpAction(command: string): CLIErrorNextAction {
  return {
    command: "tailor",
    args: [...command.split(/\s+/).filter(Boolean), "--help"],
  };
}
