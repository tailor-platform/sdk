import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { loadFilesWithIgnores } from "./file-loader";

describe("loadFilesWithIgnores", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeDirWithFile(prefix: string, relativeFile: string): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    tmpDirs.push(dir);
    fs.mkdirSync(path.dirname(path.join(dir, relativeFile)), { recursive: true });
    fs.writeFileSync(path.join(dir, relativeFile), "export const marker = true;\n");
    return dir;
  }

  test("resolves file patterns relative to baseDir, not process.cwd()", () => {
    const cwdDir = makeDirWithFile("file-loader-cwd-", "src/wrong.ts");
    const targetDir = makeDirWithFile("file-loader-target-", "src/correct.ts");

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      const files = loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, targetDir);
      expect(files).toEqual([path.join(targetDir, "src", "correct.ts")]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("falls back to process.cwd() when baseDir matches nothing", () => {
    const cwdDir = makeDirWithFile("file-loader-cwd-fallback-", "src/legacy.ts");
    const emptyBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-loader-empty-"));
    tmpDirs.push(emptyBaseDir);

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      const files = loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, emptyBaseDir);
      expect(files).toEqual([path.join(process.cwd(), "src", "legacy.ts")]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("warns when falling back to process.cwd()", () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const cwdDir = makeDirWithFile("file-loader-cwd-warn-", "src/legacy.ts");
    const emptyBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-loader-empty-warn-"));
    tmpDirs.push(emptyBaseDir);

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, emptyBaseDir);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(emptyBaseDir));
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("does not warn when baseDir itself matches", () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const targetDir = makeDirWithFile("file-loader-no-warn-", "src/correct.ts");

    loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, targetDir);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("returns immediately without warning when files is empty, even if baseDir differs from cwd", () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const emptyBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-loader-empty-patterns-"));
    tmpDirs.push(emptyBaseDir);

    const files = loadFilesWithIgnores({ files: [] }, emptyBaseDir);
    expect(files).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("does not fall back when baseDir matches something that is entirely filtered out by ignores", () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    // baseDir has a match for the pattern, but it's a default-ignored test file.
    const baseDir = makeDirWithFile("file-loader-all-ignored-", "src/foo.test.ts");
    // cwd has an unrelated, non-ignored file that must NOT leak in via a wrongful fallback.
    const cwdDir = makeDirWithFile("file-loader-unrelated-cwd-", "src/bar.ts");

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      const files = loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, baseDir);
      expect(files).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("does not fall back when a files pattern throws while globbing, even if baseDir has no other matches", () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-loader-throwing-pattern-"));
    tmpDirs.push(baseDir);
    // The "src" segment must exist so fs.globSync actually descends into it
    // and hits the null byte, instead of short-circuiting on a missing dir.
    fs.mkdirSync(path.join(baseDir, "src"));
    // cwd has an unrelated file that must NOT leak in via a wrongful fallback.
    const cwdDir = makeDirWithFile("file-loader-unrelated-cwd-throw-", "src/bar.ts");

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      // A null byte makes fs.globSync throw synchronously, rather than matching nothing.
      const files = loadFilesWithIgnores({ files: ["./src/\0bad/*.ts"] }, baseDir);
      expect(files).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("falling back"));
    } finally {
      process.chdir(originalCwd);
    }
  });
});
