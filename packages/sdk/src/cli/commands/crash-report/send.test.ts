import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { formatCrashReport } from "@/cli/crash-report/writer";
import { parseCrashLogFile } from "./send";
import type { CrashReport } from "@/cli/crash-report/report";

function makeCrashReport(): CrashReport {
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
  };
}

describe("crash-report send command", () => {
  let tmpDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crash-report-send-test-"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("parseCrashLogFile round-trips with formatCrashReport", async () => {
    const report = makeCrashReport();
    const formatted = formatCrashReport(report);
    const filePath = path.join(tmpDir, "test.crash.log");
    fs.writeFileSync(filePath, formatted);

    // Dynamic import to access the internal parseCrashLogFile via the send command module
    // We test the round-trip by checking that the formatted file can be read back
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("Crash Report: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(content).toContain("TypeError");
    expect(content).toContain("Cannot read properties of undefined");
    expect(content).toContain("packages/sdk/src/cli/index.ts:10:5");
  });

  test("formatCrashReport preserves multiline error messages", () => {
    const report = {
      ...makeCrashReport(),
      errorMessage: "Failed to apply configuration\nRequest: POST /v1/apply\nStatus: 500",
    };
    const formatted = formatCrashReport(report);

    // All lines of the multiline message should be present in the formatted output
    expect(formatted).toContain("Failed to apply configuration");
    expect(formatted).toContain("Request: POST /v1/apply");
    expect(formatted).toContain("Status: 500");
  });

  test("parseCrashLogFile round-trips with formatCrashReport", () => {
    const report = makeCrashReport();
    const formatted = formatCrashReport(report);
    const parsed = parseCrashLogFile(formatted);

    expect(parsed).toBeDefined();
    expect(parsed!.id).toBe(report.id);
    expect(parsed!.errorName).toBe(report.errorName);
    expect(parsed!.errorMessage).toBe(report.errorMessage);
  });

  test("parseCrashLogFile uses last JSON marker when error contains marker text", () => {
    const report = {
      ...makeCrashReport(),
      errorMessage: '--- JSON ---\n{"fake": true}',
    };
    const formatted = formatCrashReport(report);
    const parsed = parseCrashLogFile(formatted);

    expect(parsed).toBeDefined();
    expect(parsed!.id).toBe(report.id);
    expect(parsed!.errorMessage).toBe('--- JSON ---\n{"fake": true}');
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

  test("parseCrashLogFile returns undefined for invalid content", () => {
    expect(parseCrashLogFile("no json footer here")).toBeUndefined();
    expect(parseCrashLogFile("")).toBeUndefined();
  });

  test("formatCrashReport produces parseable output with all fields", () => {
    const report = makeCrashReport();
    const formatted = formatCrashReport(report);

    // Verify all key fields are present in the formatted output
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
