import { setTimeout as sleep } from "node:timers/promises";
import { Code, ConnectError } from "@connectrpc/connect";
import { getAppHealthWith } from "@/cli/commands/workspace/app/health";
import { logger, styles } from "@/cli/shared/logger";
import type { AppHealthInfo } from "@/cli/commands/workspace/app/transform";
import type { OperatorClient } from "@/cli/shared/client";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const INITIAL_DELAY_MS = 2_000;

export interface WaitForHealthyParams {
  client: OperatorClient;
  workspaceId: string;
  applicationName: string;
  /**
   * Health snapshot captured BEFORE the apply phase. Used as the baseline so
   * that polls compare against pre-deploy state rather than any state mutated
   * during apply. Pass `null` if no app existed before deploy.
   */
  previous: AppHealthInfo | null;
  timeoutMs: number;
  pollIntervalMs?: number;
  initialDelayMs?: number;
  now?: () => number;
}

const isNotFound = (error: unknown): boolean =>
  error instanceof ConnectError && error.code === Code.NotFound;

export interface CaptureHealthSnapshotParams {
  client: OperatorClient;
  workspaceId: string;
  name: string;
}

/**
 * Capture an application's health snapshot. Returns `null` when the application
 * does not yet exist (NotFound), e.g., on the initial deploy.
 * @param params - Client, workspace ID, and application name
 * @returns Snapshot, or `null` if the application does not exist yet
 */
export async function captureHealthSnapshot(
  params: CaptureHealthSnapshotParams,
): Promise<AppHealthInfo | null> {
  try {
    return await getAppHealthWith(params);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

const isNewAttempt = (current: AppHealthInfo, previous: AppHealthInfo | null): boolean => {
  if (current.lastAttemptAt === null) return false;
  if (previous === null || previous.lastAttemptAt === null) return true;
  return current.lastAttemptAt.getTime() > previous.lastAttemptAt.getTime();
};

const isTerminalSuccess = (h: AppHealthInfo): boolean =>
  h.status === "ok" && h.lastAttemptStatus === "success";

const isTerminalFailure = (h: AppHealthInfo): boolean =>
  h.status === "composition_error" || h.lastAttemptStatus === "failure";

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
    timeoutMs,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    initialDelayMs = INITIAL_DELAY_MS,
    now = () => Date.now(),
  } = params;

  logger.info(`Waiting for application "${applicationName}" to become healthy...`, {
    mode: "stream",
  });

  const deadline = now() + timeoutMs;

  // Composition is queued just after apply; the first poll is almost always
  // stale, so give it a head start.
  await sleep(initialDelayMs);

  while (true) {
    const current = await getAppHealthWith({ client, workspaceId, name: applicationName });

    if (isNewAttempt(current, previous)) {
      if (isTerminalSuccess(current)) {
        logger.success(`Application "${applicationName}" is healthy.`, { mode: "stream" });
        return;
      }
      if (isTerminalFailure(current)) {
        const detail = current.lastAttemptError ? `: ${current.lastAttemptError}` : "";
        throw new Error(
          `Application "${applicationName}" failed schema composition${detail}. ` +
            `Run \`tailor-sdk workspace app health -n ${applicationName}\` for details.`,
        );
      }
    }

    if (now() >= deadline) {
      throw new Error(
        `Timed out waiting for application "${applicationName}" to become healthy ` +
          `(status=${current.status}, lastAttemptStatus=${current.lastAttemptStatus}). ` +
          `Deploy was applied but schema composition did not converge in time. ` +
          `Run \`tailor-sdk workspace app health -n ${applicationName}\` to inspect.`,
      );
    }

    logger.info(
      `  ${styles.dim(`status=${current.status}, lastAttempt=${current.lastAttemptStatus}`)}`,
      { mode: "stream" },
    );

    await sleep(pollIntervalMs);
  }
}
