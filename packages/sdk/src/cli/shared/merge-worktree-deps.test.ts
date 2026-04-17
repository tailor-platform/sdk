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
