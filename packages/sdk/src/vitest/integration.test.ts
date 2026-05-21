import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const integrationDir = resolve(currentDir, "integration");
const configPath = resolve(integrationDir, "vitest.config.ts");
// Run the nested `vitest run` from the SDK package root (not src/) so the
// subprocess sees the package's `package.json` and `tsconfig.json` for
// module resolution and TS transforms.
const sdkDir = resolve(currentDir, "../..");

// Resolve the workspace's installed Vitest entry rather than relying on `npx`,
// which may perform online package resolution and slow down / destabilize CI.
const require = createRequire(import.meta.url);
const vitestPackageJson = require.resolve("vitest/package.json");
const vitestBin = resolve(dirname(vitestPackageJson), "vitest.mjs");

interface VitestJsonReport {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  success: boolean;
}

interface ExecError extends Error {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function asString(buf: string | Buffer | undefined): string {
  if (buf == null) return "";
  return typeof buf === "string" ? buf : buf.toString("utf-8");
}

function runVitest(jsonOutputPath: string): VitestJsonReport {
  let execError: ExecError | undefined;
  try {
    execFileSync(
      process.execPath,
      [
        vitestBin,
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
  } catch (err) {
    // Vitest exits non-zero when any test fails. The JSON report is still
    // written in that case, so we parse it below. But if Vitest crashed
    // before producing a report (e.g. config error, timeout, native fault),
    // we need to surface its stdout/stderr instead of hiding it behind an
    // ENOENT or JSON.parse error.
    execError = err as ExecError;
  }
  if (!existsSync(jsonOutputPath)) {
    const stdout = asString(execError?.stdout);
    const stderr = asString(execError?.stderr);
    throw new Error(
      `Vitest did not produce a JSON report at ${jsonOutputPath}.\n` +
        `--- stdout ---\n${stdout}\n` +
        `--- stderr ---\n${stderr}`,
    );
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

  // The nested `vitest run` subprocess is allowed up to 30s by execFileSync
  // (see runVitest above). Set the outer test timeout comfortably above that
  // so a slow CI doesn't fail this test before the subprocess returns.
  test("blocked imports, globals removal, and allowed APIs all work", () => {
    const report = runVitest(jsonOutputPath);
    expect(report.success).toBe(true);
    expect(report.numFailedTests).toBe(0);
    expect(report.numPassedTests).toBe(report.numTotalTests);
    expect(report.numTotalTests).toBeGreaterThan(0);
  }, 60_000);
});
