import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const integrationDir = resolve(currentDir, "integration");
const configPath = resolve(integrationDir, "vitest.config.ts");
const sdkDir = resolve(currentDir, "../..");

interface VitestJsonReport {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  success: boolean;
}

function runVitest(jsonOutputPath: string): VitestJsonReport {
  try {
    execFileSync(
      "npx",
      [
        "vitest",
        "run",
        "--config",
        configPath,
        "--reporter=json",
        `--outputFile=${jsonOutputPath}`,
      ],
      {
        cwd: sdkDir,
        encoding: "utf-8",
        timeout: 30_000,
        env: { ...process.env, FORCE_COLOR: "0" },
        shell: false,
        stdio: "pipe",
      },
    );
  } catch {
    // Vitest exits non-zero when any test fails. The JSON report is still
    // written, so swallow the exit code and parse the file below.
  }
  return JSON.parse(readFileSync(jsonOutputPath, "utf-8")) as VitestJsonReport;
}

describe("tailor-runtime integration", () => {
  let tmpDir: string;
  let jsonOutputPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tailor-runtime-integration-"));
    jsonOutputPath = join(tmpDir, "report.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("blocked imports, globals removal, and allowed APIs all work", () => {
    const report = runVitest(jsonOutputPath);
    expect(report.numFailedTests).toBe(0);
    expect(report.numPassedTests).toBe(8);
    expect(report.numTotalTests).toBe(8);
    expect(report.success).toBe(true);
  });
});
