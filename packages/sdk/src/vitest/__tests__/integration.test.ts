import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const integrationDir = resolve(currentDir, "integration");
const configPath = resolve(integrationDir, "vitest.config.ts");
const sdkDir = resolve(currentDir, "../..");

function runVitest(): string {
  try {
    return execSync(`npx vitest run --config ${configPath}`, {
      cwd: sdkDir,
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  } catch (error) {
    const e = error as { stdout: string; stderr: string };
    return `${e.stdout}\n${e.stderr}`;
  }
}

describe("tailor-runtime integration", () => {
  test("blocked imports, globals removal, and allowed APIs all work", () => {
    const output = runVitest();
    expect(output).toContain("7 passed");
    expect(output).not.toContain("failed");
  });
});
