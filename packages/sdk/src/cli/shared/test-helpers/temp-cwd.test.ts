import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { tempCwd } from "./temp-cwd";

describe("tempCwd", () => {
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

  test("switches into a directory it exposes by its real path when the temp directory is a symlink", () => {
    using tmp = tempCwd("sdk-temp-cwd-");

    expect(path.dirname(tmp.dir)).toBe(realTmpDir);
    expect(process.cwd()).toBe(tmp.dir);
  });
});
