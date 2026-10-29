import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken } from "#/cli/shared/context";

/**
 * Create an operator client for the caller's own notification inbox. The inbox is per user, so
 * only the profile (for its token) is needed, never a workspace.
 * @param activeProfile - Profile name from `--profile`, if any
 * @returns Operator client authenticated as the current user
 */
export async function createNotificationClient(activeProfile?: string) {
  const accessToken = await loadAccessToken({ profile: activeProfile });
  return await initOperatorClient(accessToken);
}
