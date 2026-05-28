import { setTimeout as sleep } from "node:timers/promises";
import { Code, ConnectError } from "@connectrpc/connect";
import { getAppHealthWith, type GetAppHealthWithParams } from "@/cli/commands/workspace/app/health";
import { logger } from "@/cli/shared/logger";
import type { AppHealthInfo } from "@/cli/commands/workspace/app/transform";
import type { OperatorClient } from "@/cli/shared/client";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

export interface WaitForHealthyParams {
  client: OperatorClient;
  workspaceId: string;
  applicationName: string;
  previous: AppHealthInfo | null;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * Capture an application's health snapshot. Returns `null` when the application
 * does not yet exist (NotFound), e.g., on the initial deploy.
 * @param params - Client, workspace ID, and application name
 * @returns Snapshot, or `null` if the application does not exist yet
 */
export async function captureHealthSnapshot(
  params: GetAppHealthWithParams,
): Promise<AppHealthInfo | null> {
  try {
    return await getAppHealthWith(params);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) return null;
    throw error;
  }
}

/**
 * Wait until the application's GraphQL schema composition converges to a healthy
 * state after deployment. Polls `getApplicationSchemaHealth` and compares against
 * a pre-snapshot taken before the apply phase to ignore stale attempts.
 *
 * Resolves on healthy. Throws on composition error / failed attempt or timeout.
 * @param params - Polling parameters
 */
export async function waitForHealthy(params: WaitForHealthyParams): Promise<void> {
  const {
    client,
    workspaceId,
    applicationName,
    previous,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = params;

  logger.info(`Waiting for application "${applicationName}" to become healthy...`, {
    mode: "stream",
  });

  const deadline = Date.now() + timeoutMs;
  const previousAttemptAt = previous?.lastAttemptAt?.getTime() ?? null;

  while (true) {
    const current = await getAppHealthWith({ client, workspaceId, name: applicationName });

    const currentAttemptAt = current.lastAttemptAt?.getTime() ?? null;
    const hasNewAttempt =
      currentAttemptAt !== null &&
      (previousAttemptAt === null || currentAttemptAt > previousAttemptAt);

    if (hasNewAttempt) {
      if (current.lastAttemptStatus === "success") {
        logger.success(`Application "${applicationName}" is healthy.`, { mode: "stream" });
        return;
      }
      if (current.lastAttemptStatus === "failure") {
        throw new Error(
          `Application "${applicationName}" failed schema composition: ${current.lastAttemptError}`,
        );
      }
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for application "${applicationName}" to become healthy. ` +
          `Run \`tailor-sdk workspace app health -n ${applicationName}\` to inspect.`,
      );
    }

    await sleep(pollIntervalMs);
  }
}
