import { logBetaWarning } from "#src/cli/shared/beta";
import { initOperatorClient } from "#src/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#src/cli/shared/context";
import type { OperatorClient } from "#src/cli/shared/client";

export interface ErdDeployContext {
  client: OperatorClient;
  workspaceId: string;
}

type ErdDeployContextOptions = {
  profile?: string;
  workspaceId?: string;
};

/**
 * Initialize shared ERD command behavior.
 */
export function initErdCommand(): void {
  logBetaWarning("tailordb erd");
}

/**
 * Initialize platform context for ERD deployment.
 * @param args - CLI arguments.
 * @returns Initialized deploy context.
 */
export async function initErdDeployContext(
  args: ErdDeployContextOptions,
): Promise<ErdDeployContext> {
  initErdCommand();
  const accessToken = await loadAccessToken({
    profile: args.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: args.workspaceId,
    profile: args.profile,
  });

  return { client, workspaceId };
}
