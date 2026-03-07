import { describe, test, expect } from "vitest";
import { buildCrashReport, toRemoteReport, extractSdkStackFrames } from "./report";

describe("buildCrashReport", () => {
  test("builds a report from an Error", () => {
    const error = new Error("Something failed");
    const report = buildCrashReport({
      error,
      sdkVersion: "1.0.0",
      crashType: "handledError",
    });

    expect(report.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.sdkVersion).toBe("1.0.0");
    expect(report.nodeVersion).toBe(process.version);
    expect(report.osPlatform).toBe(process.platform);
    expect(report.arch).toBe(process.arch);
    expect(report.errorName).toBe("Error");
    expect(report.errorMessage).toBe("Something failed");
    expect(report.crashType).toBe("handledError");
    expect(report.stackTrace).toBeTruthy();
  });

  test("builds a report from a non-Error value", () => {
    const report = buildCrashReport({
      error: "string error",
      sdkVersion: "2.0.0",
      crashType: "uncaughtException",
    });

    expect(report.errorName).toBe("UnknownError");
    expect(report.errorMessage).toBe("string error");
    expect(report.stackTrace).toBe("");
    expect(report.crashType).toBe("uncaughtException");
  });

  test("sanitizes the error message", () => {
    const error = new Error(
      "User user@example.com with id 550e8400-e29b-41d4-a716-446655440000 failed",
    );
    const report = buildCrashReport({
      error,
      sdkVersion: "1.0.0",
      crashType: "handledError",
    });

    expect(report.errorMessage).not.toContain("user@example.com");
    expect(report.errorMessage).not.toContain("550e8400");
    expect(report.errorMessage).toContain("<email>");
    expect(report.errorMessage).toContain("<uuid>");
  });

  test("sanitizes the stack trace", () => {
    const error = new Error("boom");
    // Override stack for predictable testing
    error.stack = "Error: boom\n    at Object.<anonymous> (/usr/local/lib/node/some-lib.js:10:5)";
    const report = buildCrashReport({
      error,
      sdkVersion: "1.0.0",
      crashType: "handledError",
    });

    expect(report.stackTrace).not.toContain("/usr/local/");
  });

  test("sanitizes argv", () => {
    const report = buildCrashReport({
      error: new Error("test"),
      sdkVersion: "1.0.0",
      crashType: "handledError",
    });

    // argv should be an array
    expect(Array.isArray(report.argv)).toBe(true);
  });

  test("includes OS release info", () => {
    const report = buildCrashReport({
      error: new Error("test"),
      sdkVersion: "1.0.0",
      crashType: "handledError",
    });

    expect(report.osRelease).toBeTruthy();
  });
});

describe("extractSdkStackFrames", () => {
  test("extracts only packages/sdk/ lines from stack trace", () => {
    const stack = [
      "Error: boom",
      "    at foo (packages/sdk/src/cli/crash-report/index.ts:10:5)",
      "    at bar (/usr/local/lib/node_modules/some-lib/index.js:20:3)",
      "    at baz (packages/sdk/src/cli/shared/logger.ts:5:1)",
    ].join("\n");

    const frames = extractSdkStackFrames(stack);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toContain("packages/sdk/src/cli/crash-report/index.ts");
    expect(frames[1]).toContain("packages/sdk/src/cli/shared/logger.ts");
  });

  test("returns empty array when no SDK frames", () => {
    const stack = [
      "Error: boom",
      "    at bar (/usr/local/lib/node_modules/some-lib/index.js:20:3)",
    ].join("\n");

    expect(extractSdkStackFrames(stack)).toEqual([]);
  });

  test("returns empty array for empty stack", () => {
    expect(extractSdkStackFrames("")).toEqual([]);
  });
});

describe("toRemoteReport", () => {
  test("includes only allowlisted fields", () => {
    const full = buildCrashReport({
      error: new Error("sensitive message"),
      sdkVersion: "1.0.0",
      crashType: "handledError",
    });

    const remote = toRemoteReport(full);

    expect(remote.id).toBe(full.id);
    expect(remote.timestamp).toBe(full.timestamp);
    expect(remote.sdkVersion).toBe(full.sdkVersion);
    expect(remote.nodeVersion).toBe(full.nodeVersion);
    expect(remote.osPlatform).toBe(full.osPlatform);
    expect(remote.osRelease).toBe(full.osRelease);
    expect(remote.arch).toBe(full.arch);
    expect(remote.command).toBe(full.command);
    expect(remote.errorName).toBe(full.errorName);
    expect(remote.crashType).toBe(full.crashType);

    // Must NOT contain PII-carrying fields
    expect(remote).not.toHaveProperty("argv");
    expect(remote).not.toHaveProperty("errorMessage");
    expect(remote).not.toHaveProperty("stackTrace");
  });

  test("includes sdkStackTrace from SDK frames", () => {
    const full = buildCrashReport({
      error: new Error("boom"),
      sdkVersion: "1.0.0",
      crashType: "uncaughtException",
    });
    // Override stackTrace for predictable output
    full.stackTrace = [
      "Error: boom",
      "    at foo (packages/sdk/src/cli/crash-report/index.ts:10:5)",
      "    at bar (/usr/local/lib/node_modules/some-lib/index.js:20:3)",
    ].join("\n");

    const remote = toRemoteReport(full);

    expect(remote.sdkStackTrace).toHaveLength(1);
    expect(remote.sdkStackTrace[0]).toContain("packages/sdk/");
  });

  test("sdkStackTrace is empty when no SDK frames exist", () => {
    const full = buildCrashReport({
      error: new Error("boom"),
      sdkVersion: "1.0.0",
      crashType: "handledError",
    });
    full.stackTrace = "Error: boom\n    at bar (/some/other/path.js:1:1)";

    const remote = toRemoteReport(full);

    expect(remote.sdkStackTrace).toEqual([]);
  });
});
