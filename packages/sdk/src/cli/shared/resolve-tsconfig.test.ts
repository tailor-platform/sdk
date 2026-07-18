import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { resolveTSConfigWithFallback } from "./resolve-tsconfig";

describe("resolveTSConfigWithFallback", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeDirWithTsconfig(prefix: string): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}\n");
    return dir;
  }

  // A tsconfig-less directory tree, so resolveTSConfig(baseDir) genuinely
  // finds nothing while walking up baseDir's own ancestry.
  function makeIsolatedBaseDir(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-root-`)));
    tmpDirs.push(root);
    return fs.mkdtempSync(path.join(root, "no-tsconfig-"));
  }

  test("resolves the tsconfig from baseDir when one exists there", async () => {
    const baseDir = makeDirWithTsconfig("resolve-tsconfig-basedir-");
    const tsconfig = await resolveTSConfigWithFallback(baseDir);
    expect(tsconfig).toBe(path.join(baseDir, "tsconfig.json"));
  });

  test("falls back to process.cwd() when baseDir has no tsconfig anywhere in its ancestry", async () => {
    const baseDir = makeIsolatedBaseDir("resolve-tsconfig-fallback");
    tmpDirs.push(baseDir);

    const cwdDir = makeDirWithTsconfig("resolve-tsconfig-cwd-");
    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      const tsconfig = await resolveTSConfigWithFallback(baseDir);
      expect(tsconfig).toBe(path.join(cwdDir, "tsconfig.json"));
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("warns when falling back to process.cwd()", async () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const baseDir = makeIsolatedBaseDir("resolve-tsconfig-warn");
    tmpDirs.push(baseDir);

    const cwdDir = makeDirWithTsconfig("resolve-tsconfig-warn-cwd-");
    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      await resolveTSConfigWithFallback(baseDir);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(baseDir));
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("warns only once when called repeatedly for the same baseDir", async () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const baseDir = makeIsolatedBaseDir("resolve-tsconfig-dedupe");
    tmpDirs.push(baseDir);

    const cwdDir = makeDirWithTsconfig("resolve-tsconfig-dedupe-cwd-");
    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      await resolveTSConfigWithFallback(baseDir);
      await resolveTSConfigWithFallback(baseDir);
      await resolveTSConfigWithFallback(baseDir);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("returns undefined without warning when no tsconfig exists anywhere", async () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const baseDir = makeIsolatedBaseDir("resolve-tsconfig-none");
    tmpDirs.push(baseDir);

    const originalCwd = process.cwd();
    process.chdir(baseDir);
    try {
      const tsconfig = await resolveTSConfigWithFallback(baseDir);
      expect(tsconfig).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
    }
  });
});
