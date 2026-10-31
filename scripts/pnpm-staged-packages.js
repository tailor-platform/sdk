#!/usr/bin/env node

/**
 * Runs pnpm with a `--filter` for each workspace package under `packages/`
 * that has staged changes.
 *
 * Usage:
 *   node scripts/pnpm-staged-packages.js <pnpm args...>
 *
 * Exit codes:
 *   0 - No package has staged changes, so pnpm did not run
 *   otherwise - The exit code of pnpm
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { posix } from "node:path";

const files = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--no-renames", "-z", "--", "packages"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const dirs = new Set();
for (const file of files) {
  let dir = posix.dirname(file);
  while (dir !== "packages" && !existsSync(posix.join(dir, "package.json"))) {
    dir = posix.dirname(dir);
  }
  if (dir !== "packages") dirs.add(dir);
}

if (dirs.size === 0) process.exit(0);

// Through sh, as lefthook runs its jobs, so Windows resolves pnpm's shell shim rather than pnpm.cmd.
const result = spawnSync(
  "sh",
  [
    "-c",
    'exec pnpm "$@"',
    "pnpm",
    ...[...dirs].map((dir) => `--filter=./${dir}`),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
