import { initOperatorClient, loadAccessToken, loadWorkspaceId } from "@tailor-platform/sdk/cli";
import { logger } from "./shared/logger";
import type { OperatorClient } from "@tailor-platform/sdk/cli";

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
  logger.warn(
    "The 'tailordb erd' command is a beta feature and may introduce breaking changes in future releases.",
  );
  logger.newline();
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
