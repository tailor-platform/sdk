#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const [runId, separator, ...cliCommand] = process.argv.slice(2);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function exitWith(message, status = 1) {
  console.error(message);
  process.exit(status);
}

if (!runId || runId.length < 8 || runId.length > 40 || !/^[a-z0-9-]+$/.test(runId)) {
  exitWith("A valid e2e run ID is required for workspace cleanup.", 64);
}
if (separator !== "--" || cliCommand.length === 0) {
  exitWith(`Usage: ${process.argv[1]} <run-id> -- <cli-command> [args...]`, 64);
}
if (
  process.env.TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID ||
  process.env.TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET
) {
  exitWith("Machine-user client credentials must not be present during workspace cleanup.", 64);
}

const cliEnvironment = { ...process.env };
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

function listExactWorkspaces() {
  const listing = runCli(["--json", "workspace", "list"], true);
  if (listing.status !== 0) return { status: listing.status, workspaces: [] };

  let workspaces;
  try {
    workspaces = JSON.parse(listing.stdout);
  } catch {
    console.error("Workspace cleanup did not receive valid JSON.");
    return { status: 1, workspaces: [] };
  }
  if (
    !Array.isArray(workspaces) ||
    workspaces.some(
      (workspace) =>
        typeof workspace !== "object" || workspace === null || typeof workspace.name !== "string",
    )
  ) {
    console.error("Workspace cleanup received a malformed workspace list.");
    return { status: 1, workspaces: [] };
  }

  const expectedPrefix = `e2e-ws-${runId}-`;
  const exact = workspaces.filter((workspace) => workspace.name.startsWith(expectedPrefix));
  if (
    exact.some((workspace) => typeof workspace.id !== "string" || !uuidPattern.test(workspace.id))
  ) {
    console.error("Workspace cleanup received an exact candidate without a valid workspace ID.");
    return { status: 1, workspaces: [] };
  }
  if (new Set(exact.map((workspace) => workspace.id)).size !== exact.length) {
    console.error("Workspace cleanup received duplicate exact workspace IDs.");
    return { status: 1, workspaces: [] };
  }
  return { status: 0, workspaces: exact };
}

const before = listExactWorkspaces();
if (before.status !== 0) process.exit(before.status);

if (before.workspaces.length === 0) {
  console.log(`No workspaces found for exact prefix e2e-ws-${runId}-`);
} else {
  console.log(`Deleting ${before.workspaces.length} workspace(s) for run ${runId}:`);
  for (const workspace of before.workspaces) {
    console.log(`- ${JSON.stringify(workspace.name)} (${workspace.id})`);
  }
}

let firstDeletionFailure = 0;
for (const workspace of before.workspaces) {
  const deletion = runCli(["workspace", "delete", "--workspace-id", workspace.id, "--yes"]);
  if (deletion.status !== 0 && firstDeletionFailure === 0) {
    firstDeletionFailure = deletion.status;
  }
}

const after = listExactWorkspaces();
if (after.status !== 0) {
  exitWith("Workspace cleanup post-audit failed.", firstDeletionFailure || after.status);
}
if (after.workspaces.length > 0) {
  console.error(
    `Workspace cleanup left ${after.workspaces.length} workspace(s): ${after.workspaces
      .map((workspace) => JSON.stringify(workspace.name))
      .join(", ")}`,
  );
  process.exit(firstDeletionFailure || 1);
}
if (firstDeletionFailure !== 0) {
  exitWith(
    "A workspace deletion failed even though no exact workspace remains.",
    firstDeletionFailure,
  );
}

console.log("Workspace cleanup post-audit found no exact workspace.");
