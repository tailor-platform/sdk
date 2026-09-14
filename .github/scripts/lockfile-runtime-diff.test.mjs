// Fixture tests for lockfile-runtime-diff.mjs, driven as a subprocess so the
// script stays a plain top-level program (same approach as
// lockfile-audit-fix-normalize.test.mjs).
//
// pnpm 12 lockfiles are two YAML documents (a packageManagerDependencies-only
// one, then the one with real importer dependencies); pre-pnpm-12 lockfiles
// are a single document. Both shapes are covered here because a regression
// in parsing either one lets a runtime dependency change go undetected,
// which silently skips a needed changeset.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "lockfile-runtime-diff.mjs");

const pnpm12Lockfile = (esbuildVersion) => `---
lockfileVersion: '9.0'

importers:

  .:
    configDependencies: {}
    packageManagerDependencies:
      pnpm:
        specifier: 12.4.1
        version: 12.4.1

packages:

  esbuild@${esbuildVersion}:
    resolution: {integrity: sha512-x}

---
lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      typescript:
        specifier: 6.0.3
        version: 6.0.3

  packages/foo:
    dependencies:
      esbuild:
        specifier: ${esbuildVersion}
        version: ${esbuildVersion}

packages:

  esbuild@${esbuildVersion}:
    resolution: {integrity: sha512-x}
`;

const pnpm11Lockfile = (esbuildVersion) => `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      typescript:
        specifier: 6.0.3
        version: 6.0.3

  packages/foo:
    dependencies:
      esbuild:
        specifier: ${esbuildVersion}
        version: ${esbuildVersion}

packages:

  esbuild@${esbuildVersion}:
    resolution: {integrity: sha512-x}
`;

function setUp() {
  const dir = mkdtempSync(join(tmpdir(), "lockfile-runtime-diff-test-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root-app", private: true }));
  mkdirSync(join(dir, "packages", "foo"), { recursive: true });
  writeFileSync(
    join(dir, "packages", "foo", "package.json"),
    JSON.stringify({ name: "@scope/foo" }),
  );
  return dir;
}

function run(dir, before, after) {
  const beforePath = join(dir, "before-lock.yaml");
  const afterPath = join(dir, "pnpm-lock.yaml");
  writeFileSync(beforePath, before);
  writeFileSync(afterPath, after);
  // Drop GITHUB_OUTPUT so a run inside this workflow's own CI step doesn't
  // have the script under test append to the real step output file.
  const { GITHUB_OUTPUT: _githubOutput, ...env } = process.env;
  return execFileSync(process.execPath, [SCRIPT, "--before", beforePath, "--after", afterPath], {
    cwd: dir,
    encoding: "utf8",
    env,
  });
}

test("detects a runtime dependency change in a two-document pnpm-12 lockfile", () => {
  const dir = setUp();
  const stdout = run(dir, pnpm12Lockfile("0.28.1"), pnpm12Lockfile("0.28.2"));
  assert.match(stdout, /Runtime dependency changes detected in: @scope\/foo/);
});

test("reports no changes for an unchanged two-document pnpm-12 lockfile", () => {
  const dir = setUp();
  const stdout = run(dir, pnpm12Lockfile("0.28.1"), pnpm12Lockfile("0.28.1"));
  assert.match(stdout, /No runtime dependency changes/);
});

test("still detects a runtime dependency change in a single-document pre-pnpm-12 lockfile", () => {
  const dir = setUp();
  const stdout = run(dir, pnpm11Lockfile("0.28.1"), pnpm11Lockfile("0.28.2"));
  assert.match(stdout, /Runtime dependency changes detected in: @scope\/foo/);
});
