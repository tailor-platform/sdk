/**
 * Fails when the regions the Platform offers for workspace creation differ from
 * KNOWN_WORKSPACE_REGIONS, the list `tailor workspace create --help` shows.
 *
 * Usage: pnpm exec tsx scripts/check-workspace-regions.ts (needs `tailor login`)
 */

import { KNOWN_WORKSPACE_REGIONS } from "../src/cli/commands/workspace/regions";
import { initOperatorClient } from "../src/cli/shared/client";
import { loadAccessToken, loadPlatformClientConfig } from "../src/cli/shared/context";

const accessToken = await loadAccessToken({});
const platformConfig = await loadPlatformClientConfig({});
const client = await initOperatorClient(accessToken, platformConfig);
const { regions } = await client.listAvailableWorkspaceRegions({});

const platform = regions.toSorted();
const known = KNOWN_WORKSPACE_REGIONS.toSorted();

if (platform.join(",") !== known.join(",")) {
  console.error(
    `Platform offers: ${platform.join(", ")}\n` +
      `KNOWN_WORKSPACE_REGIONS: ${known.join(", ")}\n` +
      "Update src/cli/commands/workspace/regions.ts, then run `pnpm run docs:update`.",
  );
  process.exit(1);
}
console.log(`Workspace regions match the Platform: ${platform.join(", ")}`);
