#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const [runId, mode, separator, ...cliCommand] = process.argv.slice(2);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message, status = 1) {
  console.error(message);
  process.exit(status);
}

if (!runId || runId.length < 8 || runId.length > 40 || !/^[a-z0-9-]+$/.test(runId)) {
  fail("A valid e2e run ID is required for workspace cleanup.", 64);
}
if ((mode !== "preview" && mode !== "delete") || separator !== "--" || cliCommand.length === 0) {
  fail(`Usage: ${process.argv[1]} <run-id> <preview|delete> -- <cli-command> [args...]`, 64);
}
if (
  process.env.TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID ||
  process.env.TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET
) {
  fail("Machine-user client credentials must not be present during workspace cleanup.", 64);
}

const cliEnvironment = { ...process.env, TAILOR_E2E_CLEANUP_PHASE: mode };
delete cliEnvironment.TAILOR_PLATFORM_PROFILE;
delete cliEnvironment.TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID;
delete cliEnvironment.TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET;

function runCli(arguments_, captureOutput = false) {
  const result = spawnSync(cliCommand[0], [...cliCommand.slice(1), ...arguments_], {
    encoding: "utf8",
    env: cliEnvironment,
    stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    return { status: 1, stdout: "" };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

const listing = runCli(["--json", "workspace", "list"], true);
if (listing.status !== 0) process.exit(listing.status);

let workspaces;
try {
  workspaces = JSON.parse(listing.stdout);
} catch {
  fail("Workspace cleanup did not receive valid JSON.");
}
if (
  !Array.isArray(workspaces) ||
  workspaces.some(
    (workspace) =>
      typeof workspace !== "object" || workspace === null || typeof workspace.name !== "string",
  )
) {
  fail("Workspace cleanup received a malformed workspace list.");
}

const expectedPrefix = `e2e-ws-${runId}-`;
const candidates = workspaces.filter((workspace) => workspace.name.startsWith(expectedPrefix));
if (
  candidates.some(
    (workspace) => typeof workspace.id !== "string" || !uuidPattern.test(workspace.id),
  )
) {
  fail("Workspace cleanup received an exact candidate without a valid workspace ID.");
}
if (new Set(candidates.map((workspace) => workspace.id)).size !== candidates.length) {
  fail("Workspace cleanup received duplicate exact workspace IDs.");
}

if (candidates.length === 0) {
  console.log(`No workspaces found for exact prefix ${expectedPrefix}`);
  process.exit(0);
}

console.log(`Found ${candidates.length} workspace(s) for exact prefix ${expectedPrefix}`);
for (const workspace of candidates) {
  console.log(`- ${JSON.stringify(workspace.name)} (${workspace.id})`);
}
if (mode === "preview") {
  console.log("Preview complete; no workspaces were deleted.");
  process.exit(0);
}

let firstFailureStatus = 0;
let deleted = 0;
for (const workspace of candidates) {
  const deletion = runCli(["workspace", "delete", "--workspace-id", workspace.id, "--yes"]);
  if (deletion.status === 0) {
    deleted += 1;
  } else if (firstFailureStatus === 0) {
    firstFailureStatus = deletion.status;
  }
}

if (firstFailureStatus !== 0) {
  fail(
    `Workspace cleanup failed: ${deleted} deleted, ${candidates.length - deleted} failed.`,
    firstFailureStatus,
  );
}
console.log(`Workspace cleanup complete: ${deleted} deleted.`);
