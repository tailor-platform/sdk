#!/usr/bin/env node

const runId = process.argv[2];

if (!runId || runId.length < 8 || !/^[A-Za-z0-9._-]+$/.test(runId)) {
  console.error("A valid e2e run ID is required for raw workspace verification.");
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

const residualNames = workspaces
  .map((workspace) => workspace.name)
  .filter((name) => name.includes(runId));

if (residualNames.length > 0) {
  console.error(`Raw workspace verification found run ${runId}: ${residualNames.join(", ")}`);
  process.exit(1);
}

console.log(`Raw workspace verification found no workspace for run ${runId}.`);
