#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const statePath = process.env.E2E_FAKE_STATE;

if (!statePath) {
  console.error("E2E_FAKE_STATE is required.");
  process.exit(64);
}

if (args.join(" ") === "--json workspace list") {
  if (process.env.E2E_LIST_STATUS) process.exit(Number(process.env.E2E_LIST_STATUS));
  try {
    process.stdout.write(readFileSync(statePath, "utf8"));
  } catch {
    process.exit(66);
  }
  process.exit(0);
}

if (args[0] === "workspace" && args[1] === "delete") {
  const idIndex = args.indexOf("--workspace-id");
  const workspaceId = idIndex >= 0 ? args[idIndex + 1] : undefined;
  if (!workspaceId || !args.includes("--yes")) process.exit(64);

  if (process.env.E2E_DELETE_LOG) {
    appendFileSync(process.env.E2E_DELETE_LOG, `${workspaceId}\n`);
  }
  if (workspaceId === process.env.E2E_FAIL_DELETE_ID) process.exit(25);

  if (process.env.E2E_KEEP_DELETED !== "1") {
    const workspaces = JSON.parse(readFileSync(statePath, "utf8"));
    writeFileSync(
      statePath,
      `${JSON.stringify(workspaces.filter((item) => item.id !== workspaceId))}\n`,
    );
  }
  process.exit(0);
}

process.exit(64);
