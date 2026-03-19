import { logBetaWarning } from "@/cli/shared/beta";
import { initOperatorClient } from "@/cli/shared/client";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import type { OperatorClient } from "@/cli/shared/client";
import type { AppConfig } from "@/types/app-config";

export interface ErdCommandContext {
  client: OperatorClient;
  workspaceId: string;
  config: AppConfig;
}

type ErdCommandOptions = {
  profile?: string;
  workspaceId?: string;
  config?: string;
};

/**
 * Initialize shared ERD command context.
 * @param args - CLI arguments.
 * @returns Initialized context.
 */
export async function initErdContext(args: ErdCommandOptions): Promise<ErdCommandContext> {
  logBetaWarning("tailordb erd");
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: args.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: args.workspaceId,
    profile: args.profile,
  });
  const { config } = await loadConfig(args.config);

  return { client, workspaceId, config };
}
