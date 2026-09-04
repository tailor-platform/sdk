import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadPlatformClientConfig } from "#/cli/shared/context";

export async function createPatOperatorClient(activeProfile?: string) {
  const accessToken = await loadAccessToken({ profile: activeProfile });
  const platformConfig = await loadPlatformClientConfig({ profile: activeProfile });
  return await initOperatorClient(accessToken, platformConfig);
}
