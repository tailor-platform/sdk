/**
 * Cleanup script for e2e test workspaces
 *
 * Deletes all workspaces with names starting with "e2e-ws-" or "mig-ws-"
 *
 * Usage:
 *   npx tsx scripts/cleanup-e2e-workspaces.ts           # Delete all e2e workspaces
 *   npx tsx scripts/cleanup-e2e-workspaces.ts --dry-run # List without deleting
 */

import { initOperatorClient, type OperatorClient } from "../src/cli/client";
import { loadAccessToken } from "../src/cli/context";

const E2E_WORKSPACE_PREFIXES = ["e2e-ws-", "mig-ws-"];

interface Workspace {
  id?: string;
  name?: string;
}

/**
 * Fetch all workspaces with pagination
 * @param {OperatorClient} client - Operator client
 * @returns {Promise<Workspace[]>} All workspaces
 */
async function fetchAllWorkspaces(client: OperatorClient): Promise<Workspace[]> {
  const allWorkspaces: Workspace[] = [];
  let pageToken = "";

  while (true) {
    const response = await client.listWorkspaces({
      pageToken: pageToken || undefined,
    });

    const workspaces = response.workspaces ?? [];
    allWorkspaces.push(...workspaces);

    if (!response.nextPageToken) {
      break;
    }
    pageToken = response.nextPageToken;
  }

  return allWorkspaces;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    console.log("🔍 DRY RUN MODE - No workspaces will be deleted\n");
  }

  // Initialize client
  const accessToken = await loadAccessToken({ useProfile: false });
  const client = await initOperatorClient(accessToken);

  // List all workspaces with pagination
  console.log("Fetching all workspaces (with pagination)...\n");
  const workspaces = await fetchAllWorkspaces(client);
  console.log(`Total workspaces found: ${workspaces.length}\n`);

  // Filter e2e workspaces
  const e2eWorkspaces = workspaces.filter((ws) =>
    E2E_WORKSPACE_PREFIXES.some((prefix) => ws.name?.startsWith(prefix)),
  );

  if (e2eWorkspaces.length === 0) {
    console.log("✅ No e2e workspaces found to delete.");
    return;
  }

  console.log(`Found ${e2eWorkspaces.length} e2e workspace(s):\n`);
  for (const ws of e2eWorkspaces) {
    console.log(`  - ${ws.name} (${ws.id})`);
  }
  console.log();

  if (dryRun) {
    console.log("🔍 DRY RUN - Skipping deletion");
    return;
  }

  // Delete each workspace
  console.log("Deleting workspaces...\n");
  let deleted = 0;
  let failed = 0;

  for (const ws of e2eWorkspaces) {
    try {
      console.log(`  Deleting ${ws.name}...`);
      await client.deleteWorkspace({ workspaceId: ws.id! });
      console.log(`  ✅ Deleted ${ws.name}`);
      deleted++;
    } catch (error) {
      console.error(`  ❌ Failed to delete ${ws.name}:`, error);
      failed++;
    }
  }

  console.log(`\n✅ Cleanup complete: ${deleted} deleted, ${failed} failed`);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
