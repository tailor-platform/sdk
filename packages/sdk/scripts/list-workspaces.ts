/**
 * List all workspaces
 */

import { initOperatorClient } from "../src/cli/client";
import { loadAccessToken } from "../src/cli/context";

async function main() {
  const accessToken = await loadAccessToken({ useProfile: false });
  const client = await initOperatorClient(accessToken);

  console.log("Fetching workspaces...\n");
  const response = await client.listWorkspaces({});
  const workspaces = response.workspaces ?? [];

  if (workspaces.length === 0) {
    console.log("No workspaces found.");
    return;
  }

  console.log(`Found ${workspaces.length} workspace(s):\n`);
  for (const ws of workspaces) {
    console.log(`  - ${ws.name} (${ws.id})`);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
