import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "pathe";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const CODEMODS_DIR = path.resolve(__dirname, "../../../../codemods");

/**
 * Bundle a codemod transform and run jssg test against its fixtures.
 * @param codemodPath - Relative path from the codemods root
 * @returns Test result with pass status and output
 */
async function runCodemodTest(codemodPath: string): Promise<{ passed: boolean; output: string }> {
  const scriptPath = path.join(CODEMODS_DIR, codemodPath, "scripts/transform.ts");
  const testsPath = path.join(CODEMODS_DIR, codemodPath, "tests");

  // Bundle TS → JS
  const { stdout: bundled } = await execFileAsync(
    "npx",
    ["codemod", "jssg", "bundle", scriptPath],
    { timeout: 30_000 },
  );

  // Write bundled to temp file
  const fs = await import("node:fs");
  const os = await import("node:os");
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codemod-test-"));
  const bundledPath = path.join(tmpDir, "transform.js");
  await fs.promises.writeFile(bundledPath, bundled);

  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["codemod", "jssg", "test", bundledPath, testsPath, "--language", "typescript"],
      { timeout: 60_000 },
    );
    const output = stdout + stderr;
    return { passed: output.includes("0 failed"), output };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return { passed: false, output: (err.stdout ?? "") + (err.stderr ?? "") };
  } finally {
    const fs2 = await import("node:fs");
    await fs2.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

describe("codemod transforms", () => {
  it("v2/define-generators-to-plugins transforms correctly", { timeout: 60_000 }, async () => {
    const result = await runCodemodTest("v2/define-generators-to-plugins");
    expect(result.output).toContain("1 passed");
    expect(result.passed).toBe(true);
  });
});
