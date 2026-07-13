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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
});
