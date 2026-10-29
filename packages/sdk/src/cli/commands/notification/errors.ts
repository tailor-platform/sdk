import { Code, ConnectError } from "@connectrpc/connect";
import { CLIError } from "#/cli/shared/errors";

/**
 * Throw the CLI's not-found error for a notification the platform refused to return.
 * @param id - Notification id the user asked for
 * @param cause - Error from the platform
 * @returns Never; always throws
 */
export function notificationNotFound(id: string, cause?: unknown): never {
  throw CLIError({
    code: "NOTIFICATION_NOT_FOUND",
    message: `Notification "${id}" not found.`,
    details: "It is not addressed to you, or it has expired, been revoked, or been dismissed.",
    cause,
  });
}

/**
 * Rethrow a platform error, turning NotFound into the CLI's notification-not-found error.
 * @param id - Notification id the request was about
 * @param error - Error from the platform
 * @returns Never; always throws
 */
export function rethrowNotificationError(id: string, error: unknown): never {
  if (error instanceof ConnectError && error.code === Code.NotFound) {
    notificationNotFound(id, error);
  }
  throw error;
}
