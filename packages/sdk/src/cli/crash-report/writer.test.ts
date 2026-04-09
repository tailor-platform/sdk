import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { formatCrashReport, writeCrashReport } from "./writer";
import type { CrashReport } from "./report";

function makeCrashReport(overrides?: Partial<CrashReport>): CrashReport {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    timestamp: "2026-03-07T10:30:00.000Z",
    sdkVersion: "1.0.0",
    nodeVersion: "v22.0.0",
    osPlatform: "darwin",
    osRelease: "25.3.0",
    arch: "arm64",
    command: "apply",
    argv: ["node", "tailor-sdk", "apply"],
    errorName: "TypeError",
    errorMessage: "Cannot read properties of undefined",
    stackTrace:
      "TypeError: Cannot read properties of undefined\n    at foo (packages/sdk/src/cli/index.ts:10:5)",
    errorType: "handledError",
    userId: null,
    userEmail: null,
    ...overrides,
  };
}

describe("formatCrashReport", () => {
  test("formats a crash report as human-readable text", () => {
    const report = makeCrashReport();
    const text = formatCrashReport(report);

    expect(text).toContain("Crash Report: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(text).toContain("2026-03-07T10:30:00.000Z");
    expect(text).toContain("handledError");
    expect(text).toContain("SDK Version: 1.0.0");
    expect(text).toContain("Node Version: v22.0.0");
    expect(text).toContain("darwin 25.3.0");
    expect(text).toContain("Command: apply");
    expect(text).toContain("TypeError");
    expect(text).toContain("Cannot read properties of undefined");
  });

  test("serializes argv as JSON array", () => {
    const report = makeCrashReport({
      argv: ["node", "tailor-sdk", "apply", "--body", '{"a": "b c"}'],
    });
    const text = formatCrashReport(report);
    expect(text).toContain(
      'Arguments: ["node","tailor-sdk","apply","--body","{\\"a\\": \\"b c\\"}"]',
    );
  });

  test("handles empty stack trace", () => {
    const report = makeCrashReport({ stackTrace: "" });
    const text = formatCrashReport(report);
    expect(text).toContain("(no stack trace available)");
  });
});

describe("writeCrashReport", () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crash-report-test-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  test("writes a crash log file and returns the path", () => {
    const dir = makeTmpDir();
    const report = makeCrashReport();
    const filePath = writeCrashReport(report, dir);

    expect(filePath).toBeDefined();
    expect(fs.existsSync(filePath!)).toBe(true);
    expect(filePath!).toContain(".crash.log");

    const content = fs.readFileSync(filePath!, "utf-8");
    expect(content).toContain("Crash Report:");
    expect(content).toContain("TypeError");
  });

  test("creates directory if it does not exist", () => {
    const dir = path.join(makeTmpDir(), "nested", "crash-reports");
    const report = makeCrashReport();
    const filePath = writeCrashReport(report, dir);

    expect(filePath).toBeDefined();
    expect(fs.existsSync(filePath!)).toBe(true);
  });

  test("keeps only the last 10 crash files", () => {
    const dir = makeTmpDir();

    // Write 12 crash files
    for (let i = 0; i < 12; i++) {
      const report = makeCrashReport({
        id: `${String(i).padStart(8, "0")}-bbbb-cccc-dddd-eeeeeeeeeeee`,
        timestamp: `2026-03-07T10:${String(i).padStart(2, "0")}:00.000Z`,
      });
      writeCrashReport(report, dir);
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".crash.log"));
    expect(files.length).toBe(10);
  });
});
