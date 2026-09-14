import { afterEach, describe, test, expect } from "vitest";
import { logger, resetSecretRegistry } from "#/cli/shared/logger";
import { buildCrashReport, type ErrorType } from "./report";

// This file runs in the shared, non-isolated "unit-core" Vitest project, so registered
// secrets would otherwise leak into unrelated test files run in the same worker.
afterEach(() => {
  resetSecretRegistry();
});

function makeReport(
  error: unknown,
  overrides: { sdkVersion?: string; errorType?: ErrorType } = {},
) {
  return buildCrashReport({
    error,
    sdkVersion: overrides.sdkVersion ?? "1.0.0",
    errorType: overrides.errorType ?? "handledError",
  });
}

describe("buildCrashReport", () => {
  test("builds a report from an Error", () => {
    const report = makeReport(new Error("Something failed"));

    expect(report.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.sdkVersion).toBe("1.0.0");
    expect(report.nodeVersion).toBe(process.version);
    expect(report.osPlatform).toBe(process.platform);
    expect(report.arch).toBe(process.arch);
    expect(report.errorName).toBe("Error");
    expect(report.errorMessage).toBe("Something failed");
    expect(report.errorType).toBe("handledError");
    expect(report.stackTrace).toBeTruthy();
  });

  test("builds a report from a non-Error value", () => {
    const report = makeReport("string error", {
      sdkVersion: "2.0.0",
      errorType: "uncaughtException",
    });

    expect(report.errorName).toBe("UnknownError");
    expect(report.errorMessage).toBe("string error");
    expect(report.stackTrace).toBe("");
    expect(report.errorType).toBe("uncaughtException");
  });

  test("sanitizes the error message", () => {
    const error = new Error(
      "User user@example.com with id 550e8400-e29b-41d4-a716-446655440000 failed",
    );
    const report = makeReport(error);

    expect(report.errorMessage).not.toContain("user@example.com");
    expect(report.errorMessage).not.toContain("550e8400");
    expect(report.errorMessage).toContain("<email>");
    expect(report.errorMessage).toContain("<uuid>");
  });

  test("sanitizes the stack trace", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at Object.<anonymous> (/usr/local/lib/node/some-lib.js:10:5)";
    const report = makeReport(error);

    expect(report.stackTrace).not.toContain("/usr/local/");
  });

  test("sanitizes argv", () => {
    const report = makeReport(new Error("test"));

    expect(Array.isArray(report.argv)).toBe(true);
  });

  test("includes OS release info", () => {
    const report = makeReport(new Error("test"));

    expect(report.osRelease).toBeTruthy();
  });

  test("redacts a registered secret that the pattern sanitizers don't recognize", () => {
    logger.registerSecret("sk-live-crashreport-secret-value");
    const error = new Error("request failed with token sk-live-crashreport-secret-value");
    error.stack =
      "Error: request failed with token sk-live-crashreport-secret-value\n    at Object.<anonymous> (/tmp/x.js:1:1)";
    const report = makeReport(error);

    expect(report.errorMessage).not.toContain("sk-live-crashreport-secret-value");
    expect(report.errorMessage).toContain("<redacted>");
    expect(report.stackTrace).not.toContain("sk-live-crashreport-secret-value");
  });

  test("redacts a registered secret that appears in the command or argv", () => {
    logger.registerSecret("cmd-argv-secret-value");
    const originalArgv = process.argv;
    process.argv = ["node", "tailor", "cmd-argv-secret-value"];
    try {
      const report = makeReport(new Error("boom"));

      expect(report.command).not.toContain("cmd-argv-secret-value");
      expect(report.command).toContain("<redacted>");
      expect(report.argv).not.toContain("cmd-argv-secret-value");
      expect(report.argv.join(" ")).toContain("<redacted>");
    } finally {
      process.argv = originalArgv;
    }
  });

  test("redacts a registered secret embedded in a filesystem path before the path sanitizer strips it to a basename", () => {
    const secretPath = "/home/user/.secrets/prod-service-account-key.json";
    logger.registerSecret(secretPath);
    const error = new Error(`failed to read credentials file ${secretPath}`);
    const report = makeReport(error);

    expect(report.errorMessage).not.toContain("prod-service-account-key.json");
    expect(report.errorMessage).toContain("<redacted>");
  });
});
