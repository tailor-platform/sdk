import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const script = fileURLToPath(new URL("./pnpm-staged-packages.js", import.meta.url));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

let root;
let repo;

function git(...args) {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: repo, env, stdio: "ignore" },
  );
}

function write(path, content = "") {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}

function run(extraEnv = {}) {
  return spawnSync(process.execPath, [script, "run", "lint"], {
    cwd: repo,
    env: { ...env, PATH: `${join(root, "bin")}:${env.PATH}`, ...extraEnv },
    encoding: "utf8",
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pnpm-staged-packages-"));
  repo = join(root, "repo");
  write("../bin/pnpm", '#!/bin/sh\necho "$@"\nexit "${FAKE_PNPM_STATUS:-0}"\n');
  chmodSync(join(root, "bin", "pnpm"), 0o755);
  for (const dir of ["packages/a", "packages/a/templates/t", "packages/b", "packages/c"]) {
    write(`${dir}/package.json`, "{}");
  }
  write("packages/b/README.md", "b");
  write("README.md", "root");
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "--no-verify", "-m", "init");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("pnpm-staged-packages", () => {
  test("filters to the nearest packages of staged files, ignoring unstaged edits", () => {
    write("packages/a/templates/t/src/y.ts");
    write("packages/c/x.ts");
    git("add", "packages/a", "packages/c");
    write("packages/b/README.md", "wip");

    const result = run();

    expect(result.stdout).toBe(
      "--filter=./packages/a/templates/t --filter=./packages/c run lint\n",
    );
    expect(result.status).toBe(0);
  });

  test("selects both packages of a file moved between them", () => {
    git("mv", "packages/b/README.md", "packages/c/README.md");

    expect(run().stdout).toBe("--filter=./packages/b --filter=./packages/c run lint\n");
  });

  test("skips a deleted package", () => {
    git("rm", "-r", "-q", "packages/b");
    write("packages/c/x.ts");
    git("add", "packages/c");

    expect(run().stdout).toBe("--filter=./packages/c run lint\n");
  });

  test("does not run pnpm when no package has staged changes", () => {
    write("README.md", "changed");
    git("add", "README.md");
    write("packages/b/README.md", "wip");

    const result = run();

    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  test("exits with the status of pnpm", () => {
    write("packages/c/x.ts");
    git("add", "packages/c");

    expect(run({ FAKE_PNPM_STATUS: "3" }).status).toBe(3);
  });
});
