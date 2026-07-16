#!/usr/bin/env node

const runId = process.argv[2];
const phase = process.argv[3];

if (!runId || runId.length < 8 || runId.length > 40 || !/^[a-z0-9-]+$/.test(runId)) {
  console.error("A valid e2e run ID is required for raw workspace verification.");
  process.exit(64);
}
if (phase !== "before-delete" && phase !== "after-delete") {
  console.error("Raw workspace verification requires a valid cleanup phase.");
  process.exit(64);
}

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

let workspaces;
try {
  workspaces = JSON.parse(input);
} catch {
  console.error("Raw workspace verification did not receive valid JSON.");
  process.exit(1);
}

if (
  !Array.isArray(workspaces) ||
  workspaces.some(
    (workspace) =>
      typeof workspace !== "object" || workspace === null || typeof workspace.name !== "string",
  )
) {
  console.error("Raw workspace verification received a malformed workspace list.");
  process.exit(1);
}

const workspaceNames = workspaces.map((workspace) => workspace.name);
const expectedPrefix = `e2e-ws-${runId}-`;

if (phase === "before-delete") {
  console.log(`Raw workspace pre-audit accepted the exact namespace for run ${runId}.`);
  process.exit(0);
}

const residualNames = workspaceNames.filter((name) => name.startsWith(expectedPrefix));
if (residualNames.length > 0) {
  console.error(
    `Raw workspace verification found run ${runId}: ${residualNames.map((name) => JSON.stringify(name)).join(", ")}`,
  );
  process.exit(1);
}

console.log(`Raw workspace verification found no exact workspace for run ${runId}.`);
