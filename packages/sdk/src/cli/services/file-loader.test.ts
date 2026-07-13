import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
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
});
