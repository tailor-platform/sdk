import { initOperatorClient } from "../../client";
import { loadConfig } from "../../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { logErdBetaWarning } from "../../utils/beta";
import type { OperatorClient } from "../../client";
import type { AppConfig } from "@/configure/config";

export interface ErdCommandContext {
  client: OperatorClient;
  workspaceId: string;
  config: AppConfig;
}

/**
 * Initialize shared ERD command context.
 * @param args - CLI arguments.
 * @param args.profile - Workspace profile.
 * @param args.workspaceId - Workspace ID override.
 * @param args.config - Config path override.
 * @returns Initialized context.
 */
export async function initErdContext(args: {
  profile?: string;
  workspaceId?: string;
  config?: string;
}): Promise<ErdCommandContext> {
  logErdBetaWarning();
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: args.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: args.workspaceId,
    profile: args.profile,
  });
  const { config } = await loadConfig(args.config);

  return { client, workspaceId, config };
}
