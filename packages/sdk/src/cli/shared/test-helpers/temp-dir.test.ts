import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { makeTempDir } from "./temp-dir";

describe("makeTempDir", () => {
  let realTmpDir: string;
  aroundEach(async (runTest) => {
    realTmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sdk-real-tmp-")));
    const linkedTmpDir = `${realTmpDir}-link`;
    fs.symlinkSync(realTmpDir, linkedTmpDir);
    vi.stubEnv("TMPDIR", linkedTmpDir);
    try {
      await runTest();
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(linkedTmpDir, { force: true });
      fs.rmSync(realTmpDir, { recursive: true, force: true });
    }
  });

  test("returns the real path of a new empty directory when the temp directory is a symlink", () => {
    const dir = makeTempDir("sdk-make-temp-dir-");

    expect(path.dirname(dir)).toBe(realTmpDir);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
