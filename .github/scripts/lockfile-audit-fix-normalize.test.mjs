#!/usr/bin/env node --test
// Fixture tests for lockfile-audit-fix-normalize.mjs, driven as a subprocess
// so the script stays a plain top-level program.
//
// The override pruning deletes security pins from pnpm-workspace.yaml, so the
// cases that must keep an entry matter more here than the ones that drop it.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "lockfile-audit-fix-normalize.mjs");

// `ghost-pkg` appears only in this lockfile's own `overrides:` block: the trap
// that makes a whole-file scan report every override as live.
const LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

overrides:
  ghost-pkg@1: 2.0.0

importers:

  .:
    devDependencies:
      '@scope/live':
        specifier: 1.0.0
        version: 1.0.0

packages:

  esbuild@0.28.1:
    resolution: {integrity: sha512-x}

  '@scope/live@1.0.0':
    resolution: {integrity: sha512-y}

  parent-pkg@2.0.0:
    resolution: {integrity: sha512-z}

snapshots:

  esbuild@0.28.1: {}

  '@scope/live@1.0.0': {}

  parent-pkg@2.0.0: {}
`;

function run(workspaceYaml, { lockfile = LOCKFILE } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "normalize-test-"));
  const workspacePath = join(dir, "pnpm-workspace.yaml");
  writeFileSync(workspacePath, workspaceYaml);
  if (lockfile !== null) writeFileSync(join(dir, "pnpm-lock.yaml"), lockfile);

  const stdout = execFileSync(process.execPath, [SCRIPT, workspacePath], { encoding: "utf8" });
  return { stdout, result: readFileSync(workspacePath, "utf8") };
}

function overrideKeys(text) {
  const keys = [];
  let inBlock = false;
  for (const line of text.split("\n")) {
    if (/^overrides\s*:/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^\S/.test(line)) break;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    keys.push(trimmed.slice(0, trimmed.indexOf(":")).trim());
  }
  return keys;
}

test("drops overrides whose package left the dependency tree", () => {
  const { stdout, result } = run(`overrides:
  esbuild@>=0.17.0 <0.28.1: 0.28.1
  fast-uri@>=3.0.0 <3.1.4: 3.1.4
  ghost-pkg@1: 2.0.0
`);

  assert.deepEqual(overrideKeys(result), ["esbuild@>=0.17.0 <0.28.1"]);
  assert.match(stdout, /Dropping orphaned override entry "fast-uri@>=3\.0\.0 <3\.1\.4"/);
  assert.match(stdout, /Dropping orphaned override entry "ghost-pkg@1"/);
});

test("keeps overrides reachable through importers or peer-dependency suffixes", () => {
  const { result } = run(`overrides:
  "@scope/live@<1": 1.0.0
  parent-pkg>child-pkg: 3.0.0
`);

  assert.deepEqual(overrideKeys(result), ['"@scope/live@<1"', "parent-pkg>child-pkg"]);
});

test("does not confuse a package name with a longer one ending in it", () => {
  const { result } = run(`overrides:
  build@<1: 1.0.0
`);

  assert.deepEqual(overrideKeys(result), []);
});

test("honours a keep-override opt-out comment", () => {
  const { stdout, result } = run(`overrides:
  # keep-override: pinned ahead of the dependency landing
  future-pkg@<9: 9.0.0
`);

  assert.deepEqual(overrideKeys(result), ["future-pkg@<9"]);
  assert.doesNotMatch(stdout, /Dropping orphaned override entry/);
});

test("drops the comment attached to a pruned entry", () => {
  const { result } = run(`overrides:
  # plain note about a dead pin
  fast-uri@>=3.0.0 <3.1.4: 3.1.4
  esbuild@>=0.17.0 <0.28.1: 0.28.1
`);

  assert.doesNotMatch(result, /plain note/);
  assert.deepEqual(overrideKeys(result), ["esbuild@>=0.17.0 <0.28.1"]);
});

test("keeps every override when the lockfile is missing", () => {
  const { stdout, result } = run(
    `overrides:
  fast-uri@>=3.0.0 <3.1.4: 3.1.4
`,
    { lockfile: null },
  );

  assert.deepEqual(overrideKeys(result), ["fast-uri@>=3.0.0 <3.1.4"]);
  assert.match(stdout, /keeping every override/);
});

test("keeps every override when the lockfile has no packages block", () => {
  const { stdout, result } = run(
    `overrides:
  fast-uri@>=3.0.0 <3.1.4: 3.1.4
`,
    { lockfile: "lockfileVersion: '9.0'\n\noverrides:\n  fast-uri@x: 1\n" },
  );

  assert.deepEqual(overrideKeys(result), ["fast-uri@>=3.0.0 <3.1.4"]);
  assert.match(stdout, /keeping every override/);
});

test("removes the overrides key itself once the block empties", () => {
  const { result } = run(`minimumReleaseAge: 4320

overrides:
  ghost-pkg@1: 2.0.0

blockExoticSubdeps: true
`);

  assert.doesNotMatch(result, /^overrides:/m);
  assert.equal(result, "minimumReleaseAge: 4320\n\nblockExoticSubdeps: true\n");
});

test("is idempotent", () => {
  const workspace = `overrides:
  esbuild@>=0.17.0 <0.28.1: 0.28.1
  fast-uri@>=3.0.0 <3.1.4: 3.1.4
`;
  const first = run(workspace).result;
  const { stdout, result: second } = run(first);

  assert.equal(second, first);
  assert.match(stdout, /already normalized/);
});
