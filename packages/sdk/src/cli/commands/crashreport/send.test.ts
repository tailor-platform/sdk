import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { formatCrashReport } from "#/cli/crashreport/writer";
import { parseCrashLogFile } from "./send";
import type { CrashReport } from "#/cli/crashreport/report";

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

describe("crashreport send command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crash-report-send-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("formatCrashReport output round-trips through a written file", async () => {
    const report = makeCrashReport();
    const formatted = formatCrashReport(report);
    const filePath = path.join(tmpDir, "test.crash.log");
    fs.writeFileSync(filePath, formatted);

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("Crash Report: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(content).toContain("TypeError");
    expect(content).toContain("Cannot read properties of undefined");
    expect(content).toContain("packages/sdk/src/cli/index.ts:10:5");
  });

  test("formatCrashReport preserves multiline error messages", () => {
    const report = makeCrashReport({
      errorMessage: "Failed to apply configuration\nRequest: POST /v1/apply\nStatus: 500",
    });
    const formatted = formatCrashReport(report);

    expect(formatted).toContain("Failed to apply configuration");
    expect(formatted).toContain("Request: POST /v1/apply");
    expect(formatted).toContain("Status: 500");
  });

  test.each([
    ["a plain report", makeCrashReport()],
    [
      "a report whose error message contains JSON marker text",
      makeCrashReport({ errorMessage: '--- JSON ---\n{"fake": true}' }),
    ],
  ])("parseCrashLogFile round-trips %s", (_label, report) => {
    const formatted = formatCrashReport(report);
    const parsed = parseCrashLogFile(formatted);

    expect(parsed).toBeDefined();
    expect(parsed!.id).toBe(report.id);
    expect(parsed!.errorName).toBe(report.errorName);
    expect(parsed!.errorMessage).toBe(report.errorMessage);
  });

  test("parseCrashLogFile handles CRLF line endings", () => {
    const report = makeCrashReport();
    const formatted = formatCrashReport(report);
    const crlfContent = formatted.replace(/\n/g, "\r\n");
    const parsed = parseCrashLogFile(crlfContent);

    expect(parsed).toBeDefined();
    expect(parsed!.id).toBe(report.id);
    expect(parsed!.errorName).toBe(report.errorName);
  });

  test.each([
    ["content with no JSON footer", "no json footer here"],
    ["empty content", ""],
  ])("parseCrashLogFile returns undefined for %s", (_label, content) => {
    expect(parseCrashLogFile(content)).toBeUndefined();
  });

  test("formatCrashReport produces parseable output with all fields", () => {
    const report = makeCrashReport();
    const formatted = formatCrashReport(report);

    expect(formatted).toContain(`Crash Report: ${report.id}`);
    expect(formatted).toContain(`Timestamp: ${report.timestamp}`);
    expect(formatted).toContain(`SDK Version: ${report.sdkVersion}`);
    expect(formatted).toContain(`Node Version: ${report.nodeVersion}`);
    expect(formatted).toContain(`OS: ${report.osPlatform} ${report.osRelease}`);
    expect(formatted).toContain(`Arch: ${report.arch}`);
    expect(formatted).toContain(`Command: ${report.command}`);
    expect(formatted).toContain(`Name: ${report.errorName}`);
    expect(formatted).toContain(`Message: ${report.errorMessage}`);
    expect(formatted).toContain(`Error Type: ${report.errorType}`);
  });
});
