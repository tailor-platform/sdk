import { Code, ConnectError } from "@connectrpc/connect";

/**
 * Format a caught error into a string for diagnostics.
 * @param error - Error to format
 * @returns Error message string
 */
export function formatWaitError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Check whether a polling error is retryable (transient platform errors).
 * @param error - Error to check
 * @returns True if the error should be retried
 */
export function isRetryableWaitError(error: unknown): boolean {
  if (!(error instanceof ConnectError)) {
    return false;
  }
  return (
    error.code === Code.Aborted ||
    error.code === Code.ResourceExhausted ||
    error.code === Code.Unavailable
  );
}
