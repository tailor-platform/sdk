import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const integrationDir = resolve(currentDir, "integration");
const configPath = resolve(integrationDir, "vitest.config.ts");
const sdkDir = resolve(currentDir, "../..");

function runVitest(testFile: string): { exitCode: number; output: string } {
  const cmd = `npx vitest run --config ${configPath} ${resolve(integrationDir, testFile)}`;
  try {
    const output = execSync(cmd, {
      cwd: sdkDir,
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    return { exitCode: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { exitCode: e.status, output: `${e.stdout}\n${e.stderr}` };
  }
}

describe("tailor-runtime integration", () => {
  test("production code importing node:crypto is blocked", () => {
    const { output } = runVitest("should-fail.test.ts");
    expect(output).toContain("1 passed");
    expect(output).not.toContain("failed");
  });

  test("web crypto and test-file node:crypto imports work", () => {
    const { output } = runVitest("should-pass.test.ts");
    expect(output).toContain("2 passed");
    expect(output).not.toContain("failed");
  });
});
