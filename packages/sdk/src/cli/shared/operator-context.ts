import { initOperatorClient, type OperatorClientOptions } from "./client";
import { loadAccessToken, loadWorkspaceId } from "./context";

type LoadOperatorWorkspaceContextOptions = {
  profile?: string;
  workspaceId?: string;
  clientOptions?: OperatorClientOptions;
};

export async function loadOperatorWorkspaceContext(options: LoadOperatorWorkspaceContextOptions) {
  const accessToken = await loadAccessToken({ profile: options.profile });
  const client = await initOperatorClient(accessToken, undefined, options.clientOptions);
  const workspaceId = await loadWorkspaceId({
    profile: options.profile,
    workspaceId: options.workspaceId,
  });
  return { client, workspaceId };
}
