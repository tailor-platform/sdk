import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { expectRemovalInFutureMajor } from "#/cli/shared/test-helpers/removal-version";
import { makeTempDir } from "#/cli/shared/test-helpers/temp-dir";
import { loadFilesWithIgnores } from "./file-loader";

// Delegates to the real implementation by default, so only the one test
// that needs fs.globSync to throw has to override it.
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, globSync: vi.fn(original.globSync) };
});

describe("loadFilesWithIgnores", () => {
  const tmpDirs: string[] = [];

  aroundEach(async (runTest) => {
    await runTest();
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeDirWithFile(prefix: string, relativeFile: string): string {
    const dir = makeTempDir(prefix);
    tmpDirs.push(dir);
    fs.mkdirSync(path.dirname(path.join(dir, relativeFile)), { recursive: true });
    fs.writeFileSync(path.join(dir, relativeFile), "export const marker = true;\n");
    return dir;
  }

  function writeFiles(dir: string, relativeFiles: string[]): void {
    for (const relativeFile of relativeFiles) {
      fs.mkdirSync(path.dirname(path.join(dir, relativeFile)), { recursive: true });
      fs.writeFileSync(path.join(dir, relativeFile), "export const marker = true;\n");
    }
  }

  test("excludes files matched by a pattern starting with !", () => {
    const warnSpy = vi.fn();
    const baseDir = makeDirWithFile("file-loader-negation-", "src/a.ts");
    writeFiles(baseDir, ["src/ci-only.ts", "src/a.test.ts"]);

    const files = loadFilesWithIgnores(
      { files: ["./src/**/*.ts", "!./src/ci-only.ts"] },
      baseDir,
      warnSpy,
    );
    expect(files).toEqual([path.join(baseDir, "src", "a.ts")]);
  });

  test("re-includes an excluded file with a later pattern, once", () => {
    const warnSpy = vi.fn();
    const baseDir = makeDirWithFile("file-loader-reinclude-", "src/a.ts");
    writeFiles(baseDir, ["src/internal/drop.ts", "src/internal/keep.ts"]);

    const files = loadFilesWithIgnores(
      { files: ["./src/**/*.ts", "!./src/internal/**", "./src/internal/keep.ts"] },
      baseDir,
      warnSpy,
    );
    expect(files.toSorted()).toEqual([
      path.join(baseDir, "src", "a.ts"),
      path.join(baseDir, "src", "internal", "keep.ts"),
    ]);
  });

  test("returns a file matched by several patterns once", () => {
    const warnSpy = vi.fn();
    const baseDir = makeDirWithFile("file-loader-overlap-", "src/a.ts");

    const files = loadFilesWithIgnores(
      { files: ["./src/**/*.ts", "./src/a.ts"] },
      baseDir,
      warnSpy,
    );
    expect(files).toEqual([path.join(baseDir, "src", "a.ts")]);
  });

  test("does not exclude files matched only by patterns after the ! pattern", () => {
    const warnSpy = vi.fn();
    const baseDir = makeDirWithFile("file-loader-negation-order-", "src/a.ts");

    const files = loadFilesWithIgnores(
      { files: ["!./src/a.ts", "./src/**/*.ts"] },
      baseDir,
      warnSpy,
    );
    expect(files).toEqual([path.join(baseDir, "src", "a.ts")]);
  });

  test("does not fall back when every non-! pattern is absolute", () => {
    const warnSpy = vi.fn();
    const cwdDir = makeDirWithFile("file-loader-absolute-negation-cwd-", "src/legacy.ts");
    const emptyBaseDir = makeTempDir("file-loader-absolute-negation-base-");
    tmpDirs.push(emptyBaseDir);
    const absolutePattern = path.join(emptyBaseDir, "src", "**", "*.ts");

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      const files = loadFilesWithIgnores(
        { files: [absolutePattern, "!./src/legacy.ts"] },
        emptyBaseDir,
        warnSpy,
      );
      expect(files).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("returns nothing without warning when files has only ! patterns", () => {
    const warnSpy = vi.fn();
    const cwdDir = makeDirWithFile("file-loader-only-negation-cwd-", "src/a.ts");
    const emptyBaseDir = makeTempDir("file-loader-only-negation-base-");
    tmpDirs.push(emptyBaseDir);

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      const files = loadFilesWithIgnores({ files: ["!./src/a.ts"] }, emptyBaseDir, warnSpy);
      expect(files).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("resolves file patterns relative to baseDir, not process.cwd()", () => {
    const warnSpy = vi.fn();
    const cwdDir = makeDirWithFile("file-loader-cwd-", "src/wrong.ts");
    const targetDir = makeDirWithFile("file-loader-target-", "src/correct.ts");

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      const files = loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, targetDir, warnSpy);
      expect(files).toEqual([path.join(targetDir, "src", "correct.ts")]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("falls back to process.cwd() when baseDir matches nothing", () => {
    const warnSpy = vi.fn();
    const cwdDir = makeDirWithFile("file-loader-cwd-fallback-", "src/legacy.ts");
    const emptyBaseDir = makeTempDir("file-loader-empty-");
    tmpDirs.push(emptyBaseDir);

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      const files = loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, emptyBaseDir, warnSpy);
      expect(files).toEqual([path.join(process.cwd(), "src", "legacy.ts")]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("warns when falling back to process.cwd(), naming a future removal major", async () => {
    const warnSpy = vi.fn();
    const cwdDir = makeDirWithFile("file-loader-cwd-warn-", "src/legacy.ts");
    const emptyBaseDir = makeTempDir("file-loader-empty-warn-");
    tmpDirs.push(emptyBaseDir);

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, emptyBaseDir, warnSpy);
      expect(warnSpy).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(emptyBaseDir));
      await expectRemovalInFutureMajor(warnSpy.mock.calls[0]?.[0] ?? "");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("warns only once when called repeatedly for the same baseDir", () => {
    const warnSpy = vi.fn();
    const cwdDir = makeDirWithFile("file-loader-dedupe-cwd-", "src/legacy.ts");
    const emptyBaseDir = makeTempDir("file-loader-dedupe-empty-");
    tmpDirs.push(emptyBaseDir);

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, emptyBaseDir, warnSpy);
      loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, emptyBaseDir, warnSpy);
      loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, emptyBaseDir, warnSpy);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test.each([true, false])("warns once per destination (shared first: %s)", (sharedFirst) => {
    const warnSpy = vi.fn();
    const sharedWarn = vi.fn();
    const cwdDir = makeDirWithFile("file-loader-destinations-cwd-", "src/legacy.ts");
    const baseDir = makeTempDir("file-loader-destinations-base-");
    tmpDirs.push(baseDir);
    const config = { files: ["./src/**/*.ts"] };
    const loaders = [
      () => loadFilesWithIgnores(config, baseDir, sharedWarn),
      () => loadFilesWithIgnores(config, baseDir, warnSpy),
    ];
    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      for (const load of sharedFirst ? loaders : loaders.toReversed()) {
        for (let i = 0; i < 2; i++) {
          expect(load()).toEqual([path.join(process.cwd(), "src/legacy.ts")]);
        }
      }
      expect(sharedWarn).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("warns again for a different pattern set sharing the same baseDir", () => {
    const warnSpy = vi.fn();
    const cwdDir = makeDirWithFile("file-loader-dedupe-patterns-cwd-", "src/legacy.ts");
    fs.mkdirSync(path.join(cwdDir, "other"), { recursive: true });
    fs.writeFileSync(path.join(cwdDir, "other", "legacy.ts"), "export const legacy = true;\n");
    const emptyBaseDir = makeTempDir("file-loader-dedupe-patterns-");
    tmpDirs.push(emptyBaseDir);

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, emptyBaseDir, warnSpy);
      loadFilesWithIgnores({ files: ["./other/**/*.ts"] }, emptyBaseDir, warnSpy);
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("does not warn when baseDir itself matches", () => {
    const warnSpy = vi.fn();
    const targetDir = makeDirWithFile("file-loader-no-warn-", "src/correct.ts");

    loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, targetDir, warnSpy);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("returns immediately without warning when files is empty, even if baseDir differs from cwd", () => {
    const warnSpy = vi.fn();
    const emptyBaseDir = makeTempDir("file-loader-empty-patterns-");
    tmpDirs.push(emptyBaseDir);

    const files = loadFilesWithIgnores({ files: [] }, emptyBaseDir, warnSpy);
    expect(files).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("does not warn or fall back when every pattern is already absolute", () => {
    const warnSpy = vi.fn();
    const cwdDir = makeDirWithFile("file-loader-absolute-cwd-", "src/legacy.ts");
    const emptyBaseDir = makeTempDir("file-loader-absolute-base-");
    tmpDirs.push(emptyBaseDir);
    const absolutePattern = path.join(emptyBaseDir, "src", "**", "*.ts");

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      const files = loadFilesWithIgnores({ files: [absolutePattern] }, emptyBaseDir, warnSpy);
      expect(files).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("applies default ignores to files matched by a pattern that escapes baseDir", () => {
    const warnSpy = vi.fn();
    const targetDir = makeDirWithFile("file-loader-escaping-target-", "src/correct.ts");
    fs.writeFileSync(
      path.join(targetDir, "src", "correct.test.ts"),
      "export const marker = true;\n",
    );
    const baseDir = makeTempDir("file-loader-escaping-base-");
    tmpDirs.push(baseDir);
    const escapingPattern = path.join(targetDir, "src", "**", "*.ts");

    const files = loadFilesWithIgnores({ files: [escapingPattern] }, baseDir, warnSpy);
    expect(files).toEqual([path.join(targetDir, "src", "correct.ts")]);
  });

  test("does not fall back when baseDir matches something that is entirely filtered out by ignores", () => {
    const warnSpy = vi.fn();
    // baseDir has a match for the pattern, but it's a default-ignored test file.
    const baseDir = makeDirWithFile("file-loader-all-ignored-", "src/foo.test.ts");
    // cwd has an unrelated, non-ignored file that must NOT leak in via a wrongful fallback.
    const cwdDir = makeDirWithFile("file-loader-unrelated-cwd-", "src/bar.ts");

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      const files = loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, baseDir, warnSpy);
      expect(files).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("does not fall back when a files pattern throws while globbing, even if baseDir has no other matches", () => {
    const warnSpy = vi.fn();
    const baseDir = makeTempDir("file-loader-throwing-pattern-");
    tmpDirs.push(baseDir);
    // cwd has an unrelated file that must NOT leak in via a wrongful fallback.
    const cwdDir = makeDirWithFile("file-loader-unrelated-cwd-throw-", "src/bar.ts");

    // Simulate a glob failure directly, rather than relying on OS-specific
    // fs.globSync behavior for a malformed pattern (e.g. a null byte throws
    // on macOS but not on Linux).
    const throwingPattern = path.resolve(baseDir, "./src/**/*.ts");
    const mockedGlobSync = vi.mocked(fs.globSync);
    const originalImplementation = mockedGlobSync.getMockImplementation()!;
    mockedGlobSync.mockImplementation((pattern, options) => {
      if (pattern === throwingPattern) {
        throw new Error("simulated glob failure");
      }
      return originalImplementation(pattern, options);
    });

    const originalCwd = process.cwd();
    process.chdir(cwdDir);
    try {
      const files = loadFilesWithIgnores({ files: ["./src/**/*.ts"] }, baseDir, warnSpy);
      expect(files).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("falling back"));
    } finally {
      process.chdir(originalCwd);
      mockedGlobSync.mockImplementation(originalImplementation);
    }
  });
});
