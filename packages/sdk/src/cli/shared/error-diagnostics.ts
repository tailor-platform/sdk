import { Code, ConnectError } from "@connectrpc/connect";

interface ErrorDiagnostics {
  code?: string;
  suggestion?: string;
  context?: Readonly<Record<string, unknown>>;
  causes?: Readonly<Record<string, unknown>>;
}

const diagnostics = new WeakMap<Error, ErrorDiagnostics>();

/**
 * Attach output diagnostics without changing the error type used by callers.
 * @param error - Original error
 * @param details - Safe diagnostic fields supplied by the producer
 * @returns Original error
 */
export function withErrorDiagnostics<T extends Error>(error: T, details: ErrorDiagnostics): T {
  diagnostics.set(error, details);
  return error;
}

/**
 * Read producer diagnostics and recovery guidance for a failure.
 * @param error - Failure being rendered
 * @returns Diagnostic fields
 */
export function getErrorDiagnostics(error: Error): ErrorDiagnostics {
  return {
    ...(error instanceof ConnectError ? { suggestion: rpcSuggestion(error.code) } : {}),
    ...diagnostics.get(error),
  };
}

function rpcSuggestion(code: Code): string | undefined {
  switch (code) {
    case Code.Unauthenticated:
      return "Check the active token and profile with `tailor auth status` (include the same --profile option). For an environment token, replace TAILOR_PLATFORM_TOKEN; otherwise log in with `tailor login` using the same profile.";
    case Code.PermissionDenied:
      return "Check the active identity and profile with `tailor auth status` (include the same --profile option), then verify its workspace role and token permissions.";
    case Code.Unavailable:
    case Code.DeadlineExceeded:
      return "Check network connectivity and platform availability. A write may already have completed; inspect the current resource state before retrying.";
    default:
      return undefined;
  }
}
