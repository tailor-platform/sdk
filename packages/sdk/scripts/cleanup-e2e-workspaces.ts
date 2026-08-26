/**
 * Cleanup script for e2e test workspaces
 *
 * Deletes workspaces with names starting with "e2e-ws-", "template-e2e-", or "sdk-ci-".
 *
 * Usage:
 *   npx tsx scripts/cleanup-e2e-workspaces.ts                     # Delete all e2e workspaces
 *   npx tsx scripts/cleanup-e2e-workspaces.ts --dry-run            # List without deleting
 *   npx tsx scripts/cleanup-e2e-workspaces.ts --run-id=<id>        # Only workspaces from one CI run
 *   npx tsx scripts/cleanup-e2e-workspaces.ts --local-orphans \
 *     --min-age-hours=24                                          # See "Local orphans" below
 *
 * Local orphans:
 *   A local test run (no GITHUB_RUN_ID) produces workspace names with no numeric run id, and
 *   globalSetup.ts never attaches an organization to them. Their teardown runs on normal exit but
 *   not when the process is killed or crashes, so a killed local run leaves an org-less workspace
 *   behind that CI's own run-id-scoped cleanup can never match (it has no run to look up). This
 *   authenticates as loadAccessToken()'s fallback identity (the local `tailor login` session, i.e.
 *   whoever is running the script) — the same identity the orphan workspace was created under — so
 *   it can actually delete it, unlike a CI machine user that generally cannot. `--local-orphans`
 *   restricts the sweep to workspaces with no organizationId and no run id in their name;
 *   `--min-age-hours` (required with it) additionally requires the workspace to be at least that
 *   old, so an in-progress local run is never touched.
 */

import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { initOperatorClient, type OperatorClient } from "../src/cli/shared/client";
import { loadAccessToken } from "../src/cli/shared/context";
import { assertDefined } from "../src/utils/assert";

const E2E_WORKSPACE_PREFIXES = ["e2e-ws-", "template-e2e-", "sdk-ci-"];
// Mirrors the run-id regex in .github/workflows/cleanup-e2e-workspaces.yml: the numeric segment
// right after the prefix. "sdk-ci-migration-" must precede "sdk-ci-" so the longer prefix wins.
const RUN_ID_PATTERN = /^(?:e2e-ws-|template-e2e-|sdk-ci-migration-|sdk-ci-)(\d+)/;

interface Workspace {
  id?: string;
  name?: string;
  organizationId?: string;
  createTime?: Timestamp;
}

/**
 * Fetch all workspaces with pagination
 * @param {OperatorClient} client - Operator client
 * @returns {Promise<Workspace[]>} All workspaces
 */
async function fetchAllWorkspaces(client: OperatorClient): Promise<Workspace[]> {
  const allWorkspaces: Workspace[] = [];
  let pageToken = "";

  // loop exits when the platform stops returning a page token
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    const response = await client.listWorkspaces({
      pageToken: pageToken || undefined,
    });

    const workspaces = response.workspaces;
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
  const localOrphans = process.argv.includes("--local-orphans");
  const runId = process.argv.find((a) => a.startsWith("--run-id="))?.split("=")[1];
  const minAgeHoursArg = process.argv.find((a) => a.startsWith("--min-age-hours="))?.split("=")[1];

  if (localOrphans && runId) {
    console.error("--local-orphans and --run-id are mutually exclusive.");
    process.exit(1);
  }
  let minAgeHours = 0;
  if (localOrphans) {
    if (!minAgeHoursArg) {
      console.error("--local-orphans requires --min-age-hours=<N>.");
      process.exit(1);
    }
    minAgeHours = Number(minAgeHoursArg);
    if (!Number.isFinite(minAgeHours) || minAgeHours < 0) {
      console.error(`--min-age-hours must be a non-negative number, got "${minAgeHoursArg}".`);
      process.exit(1);
    }
  }

  if (dryRun) {
    console.log("🔍 DRY RUN MODE - No workspaces will be deleted\n");
  }

  // loadAccessToken() falls back to the local `tailor login` session when neither a profile nor
  // machine-user credentials are set in the environment. In CI that's always a machine user; run
  // locally (as --local-orphans is meant to be), it's the developer/agent's own session — the same
  // identity local orphan workspaces were created under, which is why this can delete them.
  delete process.env.TAILOR_PLATFORM_PROFILE;
  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  // List all workspaces with pagination
  console.log("Fetching all workspaces (with pagination)...\n");
  const workspaces = await fetchAllWorkspaces(client);
  console.log(`Total workspaces found: ${workspaces.length}\n`);

  // Filter e2e workspaces
  const e2eWorkspaces = workspaces.filter((ws) => {
    const matchesPrefix = E2E_WORKSPACE_PREFIXES.some((prefix) => ws.name?.startsWith(prefix));
    if (!matchesPrefix) return false;
    if (localOrphans) {
      if (ws.organizationId) return false;
      if (ws.name && RUN_ID_PATTERN.test(ws.name)) return false;
      const createdAt = ws.createTime ? timestampDate(ws.createTime) : undefined;
      if (!createdAt) return false;
      const ageHours = (Date.now() - createdAt.getTime()) / 3_600_000;
      return ageHours >= minAgeHours;
    }
    // When --run-id is specified (CI), only delete workspaces from this run to avoid cross-run conflicts
    if (runId) {
      return ws.name?.includes(runId);
    }
    return true;
  });

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
      await client.deleteWorkspace({
        workspaceId: assertDefined(ws.id, `workspace "${ws.name}" missing id`),
      });
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
