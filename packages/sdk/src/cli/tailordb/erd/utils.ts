import { initOperatorClient } from "../../client";
import { loadConfig } from "../../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { logBetaWarning } from "../../utils/beta";
import type { OperatorClient } from "../../client";
import type { AppConfig } from "@/parser/app-config";

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
  const workspaceId = loadWorkspaceId({
    workspaceId: args.workspaceId,
    profile: args.profile,
  });
  const { config } = await loadConfig(args.config);

  return { client, workspaceId, config };
}
