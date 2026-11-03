import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scripts = fileURLToPath(new URL("./", import.meta.url));
const branch = "changeset-release/main";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "checkout");
  const remote = join(root, "origin.git");
  const bin = join(root, "bin");
  const statePath = join(root, "state.json");
  mkdirSync(cwd);
  mkdirSync(bin);
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  git("init", "--bare", remote);
  git("init", "-b", "main");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release@example.com");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(cwd, ".github/scripts"), { recursive: true });
  for (const path of ["release-state.mjs", "resolve-pending-release-versions.sh"]) {
    writeFileSync(join(cwd, ".github/scripts", path), readFileSync(join(scripts, path)));
  }
  mkdirSync(join(cwd, "packages/sdk"), { recursive: true });
  writeFileSync(join(cwd, "packages/sdk/package.json"), '{"version":"2.37.0"}');
  writeFileSync(join(cwd, "template.yml"), "old workflow");
  writeFileSync(join(cwd, "templates.ts"), "pending");
  writeFileSync(join(cwd, "registry.ts"), "pending");
  git("add", ".");
  git("commit", "-m", "old main");
  const old = git("rev-parse", "HEAD");
  writeFileSync(join(cwd, "template.yml"), "new workflow");
  git("commit", "-am", "update template");
  const base = git("rev-parse", "HEAD");
  git("remote", "add", "origin", remote);
  git("push", "origin", "main");
  git("checkout", "-b", branch);
  writeFileSync(join(cwd, "packages/sdk/package.json"), '{"version":"2.38.0"}');
  git("commit", "-am", "version packages");
  const head = git("rev-parse", "HEAD");
  git("checkout", "--detach", base);
  const state = { head, writes: [], branch };
  const save = () => writeFileSync(statePath, JSON.stringify(state));
  save();
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const state = JSON.parse(fs.readFileSync(process.env.TEST_STATE, "utf8"));
const [command, subcommand] = process.argv.slice(2);
if (command === "pr" && subcommand === "view") {
  console.log(state.branch);
} else if (command === "pr" && subcommand === "checkout") {
  execFileSync("git", ["checkout", state.branch]);
} else if (command === "api" && subcommand === "graphql") {
  const { variables: { input } } = JSON.parse(fs.readFileSync(0, "utf8"));
  if (input.expectedHeadOid !== state.head) {
    console.log(JSON.stringify({ errors: [{ message: "expectedHeadOid does not match" }] }));
  } else {
    state.writes.push(input);
    fs.writeFileSync(process.env.TEST_STATE, JSON.stringify(state));
    console.log(JSON.stringify({ data: { createCommitOnBranch: { commit: { oid: "new-commit" } } } }));
  }
} else {
  throw new Error("unexpected gh command: " + process.argv.slice(2).join(" "));
}
`,
  );
  writeFileSync(
    join(bin, "pnpm"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const command = process.argv[2];
if (command === "codemod:resolve-pending") {
  fs.writeFileSync("registry.ts", process.env.PREVIOUS_SDK_VERSION);
} else if (command === "setup:template-version:resolve-pending") {
  fs.writeFileSync("templates.ts", createHash("sha256").update(fs.readFileSync("template.yml")).digest("hex"));
  const state = JSON.parse(fs.readFileSync(process.env.TEST_STATE, "utf8"));
  if (state.race === "release") state.head = "concurrent-release-head";
  if (state.race === "main") execFileSync("git", ["--git-dir", process.env.TEST_REMOTE, "update-ref", "refs/heads/main", process.env.TEST_OLD]);
  if (state.race === "resolver") process.exit(1);
  fs.writeFileSync(process.env.TEST_STATE, JSON.stringify(state));
} else if (command !== "deprecations:resolve-pending" && command !== "exec") {
  throw new Error("unexpected pnpm command: " + command);
}
`,
  );
  for (const executable of ["gh", "pnpm"]) chmodSync(join(bin, executable), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_REPOSITORY: "tailor-platform/sdk",
    GITHUB_SHA: base,
    PR_NUMBER: "2917",
    TEST_STATE: statePath,
    TEST_REMOTE: remote,
    TEST_OLD: old,
  };
  const run = (...args) =>
    spawnSync(process.execPath, [join(cwd, ".github/scripts/release-state.mjs"), ...args], {
      cwd,
      env,
      encoding: "utf8",
    });
  const resolve = () =>
    spawnSync("bash", [join(cwd, ".github/scripts/resolve-pending-release-versions.sh")], {
      cwd,
      env,
      encoding: "utf8",
    });
  const readState = () => JSON.parse(readFileSync(statePath, "utf8"));
  return { cwd, git, old, base, head, state, save, env, run, resolve, readState };
}

test("current run is eligible, but a later rerun of an older commit is skipped", (t) => {
  const f = fixture(t);
  assert.equal(f.run("check").stdout, "current=true\n");
  f.git("checkout", "--detach", f.old);
  f.env.GITHUB_SHA = f.old;
  const rerun = f.run("check");
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.equal(rerun.stdout, "current=false\n");
  assert.deepEqual(f.readState().writes, []);
});

test("checkout override cannot disagree with changesets/action's event SHA", (t) => {
  const f = fixture(t);
  f.env.GITHUB_SHA = f.old;
  assert.notEqual(f.run("check").status, 0);
});

test("unavailable remote fails closed", (t) => {
  const f = fixture(t);
  f.git("remote", "set-url", "origin", join(f.cwd, "missing.git"));
  const result = f.run("check");
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
});

test("fixup commits all resolved files once against the checked-out release head", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, "packages/sdk/package.json"), "dirty changeset version output");
  writeFileSync(join(f.cwd, "untracked-changelog.md"), "new changelog");
  const result = f.resolve();
  assert.equal(result.status, 0, result.stderr);
  const [input] = f.readState().writes;
  assert.equal(f.readState().writes.length, 1);
  assert.equal(input.expectedHeadOid, f.head);
  assert.deepEqual(input.branch, {
    repositoryNameWithOwner: "tailor-platform/sdk",
    branchName: branch,
  });
  const files = Object.fromEntries(
    input.fileChanges.additions.map(({ path, contents }) => [
      path,
      Buffer.from(contents, "base64").toString(),
    ]),
  );
  assert.equal(files["registry.ts"], "2.37.0");
  assert.equal(files["templates.ts"], createHash("sha256").update("new workflow").digest("hex"));
  assert.deepEqual(Object.keys(files).sort(), ["registry.ts", "templates.ts"]);
  assert.equal(f.git("rev-parse", "HEAD"), f.base);
  assert.equal(f.git("rev-parse", branch), f.head);
  assert.equal(f.git("status", "--porcelain"), "");
});

for (const race of ["release", "main", "resolver"]) {
  test(`fixup rejects ${race} changes during resolution without a partial commit`, (t) => {
    const f = fixture(t);
    f.state.race = race;
    f.save();
    const result = f.resolve();
    assert.notEqual(result.status, 0);
    assert.deepEqual(f.readState().writes, []);
    assert.equal(f.git("rev-parse", "HEAD"), f.base);
    assert.equal(f.git("rev-parse", branch), f.head);
    assert.equal(f.git("status", "--porcelain"), "");
    if (race === "release") assert.match(result.stderr, /expectedHeadOid/);
  });
}

test("fixup rejects a release branch generated from an older main", (t) => {
  const f = fixture(t);
  f.git("branch", "--force", branch, f.old);
  const result = f.resolve();
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.readState().writes, []);
  assert.equal(f.git("rev-parse", "HEAD"), f.base);
});

test("a stale fixup invocation stops before checking out or resolving release files", (t) => {
  const f = fixture(t);
  f.git("checkout", "--detach", f.old);
  const result = f.resolve();
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.readState().writes, []);
  assert.equal(f.git("rev-parse", "HEAD"), f.old);
  assert.equal(f.git("rev-parse", branch), f.head);
});

test("no changed files means no API mutation", (t) => {
  const f = fixture(t);
  f.git("checkout", "--detach", f.head);
  assert.equal(f.run("commit", f.base, branch, f.head).status, 0);
  assert.deepEqual(f.readState().writes, []);
});
