import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkDirContext } from "../shared/test-helpers";

describe("createWorkDirContext", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to <testDirname>/../work when LLM_CHALLENGE_WORK_DIR is unset", () => {
    vi.stubEnv("LLM_CHALLENGE_WORK_DIR", "");
    const testDirname = path.join(os.tmpdir(), "test-helpers-fallback", "tests");
    const expectedWorkDir = path.resolve(testDirname, "..", "work");
    const ctx = createWorkDirContext(testDirname);
    expect(ctx.workDir).toBe(expectedWorkDir);
    expect(ctx.workDirReady).toBe(false);
  });

  it("honors LLM_CHALLENGE_WORK_DIR override", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-helpers-override-"));
    try {
      vi.stubEnv("LLM_CHALLENGE_WORK_DIR", tmp);
      const ctx = createWorkDirContext("/unused/tests");
      expect(ctx.workDir).toBe(tmp);
      expect(ctx.workDirReady).toBe(false);

      fs.mkdirSync(path.join(tmp, "node_modules"));
      const ready = createWorkDirContext("/unused/tests");
      expect(ready.workDir).toBe(tmp);
      expect(ready.workDirReady).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
