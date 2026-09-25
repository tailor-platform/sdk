import { initOperatorClient } from "./client";
import { loadAccessToken, loadWorkspaceId } from "./context";

type LoadOperatorWorkspaceContextOptions = {
  profile?: string;
  workspaceId?: string;
};

export async function loadOperatorWorkspaceContext(options: LoadOperatorWorkspaceContextOptions) {
  const accessToken = await loadAccessToken({ profile: options.profile });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    profile: options.profile,
    workspaceId: options.workspaceId,
  });
  return { client, workspaceId };
}
