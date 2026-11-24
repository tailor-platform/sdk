import { logger } from "#/cli/shared/logger";
import { pruneHint, reclaimFinishedWorkflowRuns } from "#/cli/shared/workflow-run";
import type { OperatorClient } from "#/cli/shared/client";

interface SweepBeforeRunParams {
  client: OperatorClient;
  workspaceId: string;
  profile: string | undefined;
}

/**
 * Remove the resources of finished runs before a new run starts, and warn about resources named
 * like a run's that carry no run label, which the sweep leaves in place.
 * @param params - Workspace to sweep and the profile the run uses
 */
export async function sweepBeforeRun(params: SweepBeforeRunParams): Promise<void> {
  const { client, workspaceId, profile } = params;
  const swept = await reclaimFinishedWorkflowRuns({ client, workspaceId, now: new Date() });
  if (swept && swept.keptUnlabeled.length > 0) {
    logger.warn(
      `${swept.keptUnlabeled.length} resource(s) named \`tmp-run-…\` or \`tmp-fn-…\` carry no run label and were left in place. ` +
        `If they are leftovers of an interrupted run, ${pruneHint({ workspaceId, profile, includeUnlabeled: true })} removes them.`,
    );
  }
}
