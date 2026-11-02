import { Code, ConnectError } from "@connectrpc/connect";
import { CLIError } from "#/cli/shared/errors";

/**
 * Throw the CLI's not-found error for notifications the platform refused to return.
 * @param ids - Notification ids the user asked for and the platform did not return
 * @param cause - Error from the platform
 * @returns Never; always throws
 */
export function notificationNotFound(ids: readonly string[], cause?: unknown): never {
  const quoted = ids.map((id) => `"${id}"`).join(", ");
  throw CLIError({
    code: "NOTIFICATION_NOT_FOUND",
    message:
      ids.length === 1 ? `Notification ${quoted} not found.` : `Notifications ${quoted} not found.`,
    details:
      ids.length === 1
        ? "It is not addressed to you, or it has expired, been revoked, or been dismissed."
        : "They are not addressed to you, or they have expired, been revoked, or been dismissed.",
    cause,
  });
}

/**
 * Whether the platform answered that a notification does not exist for the caller.
 * @param error - Error from the platform
 * @returns true for a NotFound answer
 */
export function isNotificationNotFound(error: unknown): boolean {
  return error instanceof ConnectError && error.code === Code.NotFound;
}

/**
 * Rethrow a platform error, turning NotFound into the CLI's notification-not-found error.
 * @param id - Notification id the request was about
 * @param error - Error from the platform
 * @returns Never; always throws
 */
export function rethrowNotificationError(id: string, error: unknown): never {
  if (isNotificationNotFound(error)) notificationNotFound([id], error);
  throw error;
}
