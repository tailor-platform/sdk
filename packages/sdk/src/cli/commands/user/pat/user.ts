import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken } from "#/cli/shared/context";

export async function createPatOperatorClient(activeProfile?: string) {
  const accessToken = await loadAccessToken({ profile: activeProfile });
  return await initOperatorClient(accessToken);
}
