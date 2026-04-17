import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linkNodeModules } from "./merge-worktree-deps";

describe("linkNodeModules", () => {
  let sourceRoot: string;
  let targetRoot: string;

  beforeEach(() => {
    sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mw-src-"));
    targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mw-tgt-"));
  });

  afterEach(() => {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  });

  function writeFile(root: string, rel: string, content: string) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  function initGitRepo(root: string) {
    const opts = { cwd: root, stdio: "ignore" as const };
    execFileSync("git", ["init", "--initial-branch=main", "--quiet"], opts);
    execFileSync("git", ["config", "user.email", "t@e.com"], opts);
    execFileSync("git", ["config", "user.name", "Test"], opts);
    execFileSync("git", ["config", "commit.gpgsign", "false"], opts);
    execFileSync("git", ["add", "."], opts);
    execFileSync("git", ["commit", "--quiet", "-m", "init"], opts);
  }

  it("populates target node_modules with entries linked from source", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock-content");
    writeFile(sourceRoot, "package.json", '{"name":"root"}');
    writeFile(sourceRoot, "node_modules/foo/index.js", "module.exports = 1;");

    writeFile(targetRoot, "pnpm-lock.yaml", "lock-content");
    writeFile(targetRoot, "package.json", '{"name":"root"}');

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("symlink");
    const tgt = path.join(targetRoot, "node_modules");
    expect(fs.lstatSync(tgt).isDirectory()).toBe(true);
    expect(fs.lstatSync(path.join(tgt, "foo")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(tgt, "foo/index.js"), "utf8")).toBe("module.exports = 1;");
  });

  it("populates nested package node_modules at workspace paths", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(sourceRoot, "packages/sdk/package.json", "{}");
    writeFile(sourceRoot, "node_modules/root-dep/index.js", "a");
    writeFile(sourceRoot, "packages/sdk/node_modules/child/index.js", "b");

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(targetRoot, "packages/sdk/package.json", "{}");

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("symlink");
    const nested = path.join(targetRoot, "packages/sdk/node_modules");
    expect(fs.lstatSync(nested).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(nested, "child/index.js"), "utf8")).toBe("b");
  });

  it("recreates workspace symlinks so they resolve inside the target worktree", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(sourceRoot, "packages/my-pkg/src/index.ts", "export const v = 'SOURCE';\n");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"));
    fs.symlinkSync("../packages/my-pkg", path.join(sourceRoot, "node_modules/my-pkg"));

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(targetRoot, "packages/my-pkg/src/index.ts", "export const v = 'MERGED';\n");

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("symlink");
    const linked = path.join(targetRoot, "node_modules/my-pkg/src/index.ts");
    expect(fs.readFileSync(linked, "utf8")).toBe("export const v = 'MERGED';\n");
  });

  it("falls back to the source location when the merged target is missing built artifacts", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(
      sourceRoot,
      "packages/sdk/package.json",
      JSON.stringify({ main: "./dist/index.mjs" }),
    );
    writeFile(sourceRoot, "packages/sdk/dist/index.mjs", "export const sdk = 'BUILT';");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"));
    fs.symlinkSync("../packages/sdk", path.join(sourceRoot, "node_modules/sdk"));

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(
      targetRoot,
      "packages/sdk/package.json",
      JSON.stringify({ main: "./dist/index.mjs" }),
    );

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("symlink");
    const linked = path.join(targetRoot, "node_modules/sdk/dist/index.mjs");
    expect(fs.readFileSync(linked, "utf8")).toBe("export const sdk = 'BUILT';");
  });

  it("aborts when a workspace package diverged and its built artifacts are absent from the merged tree", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(
      sourceRoot,
      "packages/sdk/package.json",
      JSON.stringify({ main: "./dist/index.mjs" }),
    );
    writeFile(sourceRoot, "packages/sdk/src/index.ts", "export const v = 'SOURCE';\n");
    writeFile(sourceRoot, "packages/sdk/dist/index.mjs", "export const v = 'BUILT';\n");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"));
    fs.symlinkSync("../packages/sdk", path.join(sourceRoot, "node_modules/sdk"));

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(
      targetRoot,
      "packages/sdk/package.json",
      JSON.stringify({ main: "./dist/index.mjs" }),
    );
    writeFile(targetRoot, "packages/sdk/src/index.ts", "export const v = 'MERGED';\n");

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("abort");
    expect(result.reason).toContain("sdk");
    expect(result.reason).toMatch(/rebuild/);
    expect(fs.existsSync(path.join(targetRoot, "node_modules"))).toBe(false);
  });

  it("detects missing entrypoints declared via exports-only manifests", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(
      sourceRoot,
      "packages/sdk/package.json",
      JSON.stringify({
        exports: {
          ".": { import: "./dist/index.mjs", types: "./dist/index.d.mts" },
        },
      }),
    );
    writeFile(sourceRoot, "packages/sdk/src/index.ts", "export const v = 'SRC';\n");
    writeFile(sourceRoot, "packages/sdk/dist/index.mjs", "export const v = 'BUILT';\n");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"));
    fs.symlinkSync("../packages/sdk", path.join(sourceRoot, "node_modules/sdk"));

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(
      targetRoot,
      "packages/sdk/package.json",
      JSON.stringify({
        exports: {
          ".": { import: "./dist/index.mjs", types: "./dist/index.d.mts" },
        },
      }),
    );
    // Same src between source and target so fallback is allowed.
    writeFile(targetRoot, "packages/sdk/src/index.ts", "export const v = 'SRC';\n");

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("symlink");
    const linked = path.join(targetRoot, "node_modules/sdk/dist/index.mjs");
    expect(fs.readFileSync(linked, "utf8")).toBe("export const v = 'BUILT';\n");
  });

  it("falls back to source when merged tree lacks the declared bin entrypoint", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(
      sourceRoot,
      "packages/cli/package.json",
      JSON.stringify({ bin: { "my-cli": "./dist/cli.js" } }),
    );
    writeFile(sourceRoot, "packages/cli/src/index.ts", "export const v = 'SRC';\n");
    writeFile(sourceRoot, "packages/cli/dist/cli.js", "#!/usr/bin/env node\n");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"));
    fs.symlinkSync("../packages/cli", path.join(sourceRoot, "node_modules/cli"));

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(
      targetRoot,
      "packages/cli/package.json",
      JSON.stringify({ bin: { "my-cli": "./dist/cli.js" } }),
    );
    writeFile(targetRoot, "packages/cli/src/index.ts", "export const v = 'SRC';\n");

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("symlink");
    const linked = path.join(targetRoot, "node_modules/cli/dist/cli.js");
    expect(fs.readFileSync(linked, "utf8")).toBe("#!/usr/bin/env node\n");
  });

  it("falls back to source when merged tree lacks the implicit index.js", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(sourceRoot, "packages/impl/package.json", "{}");
    writeFile(sourceRoot, "packages/impl/src/main.ts", "export const v = 'SRC';\n");
    writeFile(sourceRoot, "packages/impl/index.js", "module.exports = require('./src/main');\n");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"));
    fs.symlinkSync("../packages/impl", path.join(sourceRoot, "node_modules/impl"));

    // Gitignore the built index.js so the source checkout treats it as an
    // artifact rather than tracked content; mirrors a typical monorepo where
    // the built entrypoint lives outside git.
    writeFile(sourceRoot, ".gitignore", "packages/impl/index.js\n");
    initGitRepo(sourceRoot);

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(targetRoot, "packages/impl/package.json", "{}");
    writeFile(targetRoot, "packages/impl/src/main.ts", "export const v = 'SRC';\n");

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("symlink");
    const linked = path.join(targetRoot, "node_modules/impl/index.js");
    expect(fs.readFileSync(linked, "utf8")).toBe("module.exports = require('./src/main');\n");
  });

  it("ignores untracked source files when comparing workspace package content", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(
      sourceRoot,
      "packages/sdk/package.json",
      JSON.stringify({ main: "./dist/index.mjs" }),
    );
    writeFile(sourceRoot, "packages/sdk/src/index.ts", "export const v = 'TRACKED';\n");
    writeFile(sourceRoot, "packages/sdk/dist/index.mjs", "export const v = 'BUILT';\n");
    // Untracked files that exist only in the developer's local checkout; they
    // would spuriously abort the parity check without the git-tracked filter.
    writeFile(sourceRoot, "packages/sdk/.env", "SECRET=1\n");
    writeFile(sourceRoot, "packages/sdk/coverage-report.txt", "local run\n");
    writeFile(sourceRoot, ".gitignore", ".env\ncoverage-report.txt\n");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"));
    fs.symlinkSync("../packages/sdk", path.join(sourceRoot, "node_modules/sdk"));
    initGitRepo(sourceRoot);

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(
      targetRoot,
      "packages/sdk/package.json",
      JSON.stringify({ main: "./dist/index.mjs" }),
    );
    writeFile(targetRoot, "packages/sdk/src/index.ts", "export const v = 'TRACKED';\n");

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("symlink");
    const linked = path.join(targetRoot, "node_modules/sdk/dist/index.mjs");
    expect(fs.readFileSync(linked, "utf8")).toBe("export const v = 'BUILT';\n");
  });

  it("translates absolute intra-repo workspace symlinks to the merge worktree", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(sourceRoot, "packages/my-pkg/src/index.ts", "export const v = 'SOURCE';\n");
    fs.mkdirSync(path.join(sourceRoot, "node_modules"));
    // Absolute symlink pointing into sourceRoot (pnpm/yarn can emit these).
    fs.symlinkSync(
      path.join(sourceRoot, "packages/my-pkg"),
      path.join(sourceRoot, "node_modules/my-pkg"),
    );

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(targetRoot, "packages/my-pkg/src/index.ts", "export const v = 'MERGED';\n");

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("symlink");
    const linked = path.join(targetRoot, "node_modules/my-pkg/src/index.ts");
    expect(fs.readFileSync(linked, "utf8")).toBe("export const v = 'MERGED';\n");
  });

  it("copies external absolute symlinks verbatim (e.g. pnpm store)", () => {
    const externalStore = fs.mkdtempSync(path.join(os.tmpdir(), "mw-store-"));
    try {
      writeFile(externalStore, "pkg/package.json", JSON.stringify({ main: "./index.js" }));
      writeFile(externalStore, "pkg/index.js", "module.exports = 'STORE';");

      writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
      writeFile(sourceRoot, "package.json", "{}");
      fs.mkdirSync(path.join(sourceRoot, "node_modules"));
      fs.symlinkSync(path.join(externalStore, "pkg"), path.join(sourceRoot, "node_modules/pkg"));

      writeFile(targetRoot, "pnpm-lock.yaml", "lock");
      writeFile(targetRoot, "package.json", "{}");

      const result = linkNodeModules({ sourceRoot, targetRoot });

      expect(result.method).toBe("symlink");
      const linked = path.join(targetRoot, "node_modules/pkg/index.js");
      expect(fs.readFileSync(linked, "utf8")).toBe("module.exports = 'STORE';");
    } finally {
      fs.rmSync(externalStore, { recursive: true, force: true });
    }
  });

  it("recreates scoped workspace symlinks so they resolve inside the target worktree", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(sourceRoot, "packages/my-pkg/src/index.ts", "export const v = 'SOURCE';\n");
    fs.mkdirSync(path.join(sourceRoot, "node_modules/@scope"), { recursive: true });
    fs.symlinkSync("../../packages/my-pkg", path.join(sourceRoot, "node_modules/@scope/my-pkg"));

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(targetRoot, "packages/my-pkg/src/index.ts", "export const v = 'MERGED';\n");

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("symlink");
    const linked = path.join(targetRoot, "node_modules/@scope/my-pkg/src/index.ts");
    expect(fs.readFileSync(linked, "utf8")).toBe("export const v = 'MERGED';\n");
  });

  it("aborts when pnpm-lock.yaml differs between source and target", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock-a");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(sourceRoot, "node_modules/foo/index.js", "1");

    writeFile(targetRoot, "pnpm-lock.yaml", "lock-b");
    writeFile(targetRoot, "package.json", "{}");

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("abort");
    expect(result.reason).toMatch(/pnpm-lock\.yaml/);
    expect(fs.existsSync(path.join(targetRoot, "node_modules"))).toBe(false);
  });

  it.each([
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
  ])("aborts when %s differs between source and target", (lockfile) => {
    writeFile(sourceRoot, lockfile, "a");
    writeFile(sourceRoot, "package.json", "{}");

    writeFile(targetRoot, lockfile, "b");
    writeFile(targetRoot, "package.json", "{}");

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("abort");
    expect(result.reason).toContain(lockfile);
  });

  it("aborts when a nested lockfile differs even though the root matches", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(sourceRoot, "apps/foo/package.json", "{}");
    writeFile(sourceRoot, "apps/foo/package-lock.json", "v1");
    writeFile(sourceRoot, "apps/foo/node_modules/dep/index.js", "a");

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(targetRoot, "apps/foo/package.json", "{}");
    writeFile(targetRoot, "apps/foo/package-lock.json", "v2");

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("abort");
    expect(result.reason).toContain("apps/foo/package-lock.json");
    expect(fs.existsSync(path.join(targetRoot, "apps/foo/node_modules"))).toBe(false);
  });

  it("aborts when a nested package.json differs even though the root matches", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(sourceRoot, "packages/sdk/package.json", '{"deps":"a"}');
    writeFile(sourceRoot, "packages/sdk/node_modules/dep/index.js", "a");

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(targetRoot, "packages/sdk/package.json", '{"deps":"b"}');

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("abort");
    expect(result.reason).toContain("packages/sdk/package.json");
  });

  it("aborts when the root package.json differs", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", '{"deps":"a"}');
    writeFile(sourceRoot, "node_modules/foo/index.js", "1");

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", '{"deps":"b"}');

    const result = linkNodeModules({ sourceRoot, targetRoot });

    expect(result.method).toBe("abort");
    expect(result.reason).toMatch(/package\.json/);
  });

  it("skips node_modules directories that do not exist in the target tree", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(sourceRoot, "packages/sdk/package.json", "{}");
    writeFile(sourceRoot, "packages/sdk/node_modules/child/index.js", "b");
    writeFile(sourceRoot, "packages/removed/package.json", "{}");
    writeFile(sourceRoot, "packages/removed/node_modules/x/index.js", "x");

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");
    writeFile(targetRoot, "packages/sdk/package.json", "{}");

    const result = linkNodeModules({ sourceRoot, targetRoot });
    expect(result.method).toBe("symlink");
    expect(fs.existsSync(path.join(targetRoot, "packages/sdk/node_modules"))).toBe(true);
    expect(fs.existsSync(path.join(targetRoot, "packages/removed/node_modules"))).toBe(false);
  });

  it("is idempotent when called twice", () => {
    writeFile(sourceRoot, "pnpm-lock.yaml", "lock");
    writeFile(sourceRoot, "package.json", "{}");
    writeFile(sourceRoot, "node_modules/foo/index.js", "1");

    writeFile(targetRoot, "pnpm-lock.yaml", "lock");
    writeFile(targetRoot, "package.json", "{}");

    const first = linkNodeModules({ sourceRoot, targetRoot });
    const second = linkNodeModules({ sourceRoot, targetRoot });
    expect(first.method).toBe("symlink");
    expect(second.method).toBe("symlink");
  });
});
