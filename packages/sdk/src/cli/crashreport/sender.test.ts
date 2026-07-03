import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sendCrashReport } from "./sender";
import type { CrashReport } from "./report";

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
    argv: ["node", "tailor", "apply"],
    errorName: "TypeError",
    errorMessage: "Cannot read properties of undefined",
    stackTrace: "TypeError: Cannot read properties of undefined",
    errorType: "handledError",
    userId: null,
    userEmail: null,
  };
}

function mockFetchResolvedValue(response: unknown): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(response),
  });
}

describe("sendCrashReport", () => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.TAILOR_CRASH_REPORT_ENDPOINT;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.TAILOR_CRASH_REPORT_ENDPOINT;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEndpoint !== undefined) {
      process.env.TAILOR_CRASH_REPORT_ENDPOINT = originalEndpoint;
    } else {
      delete process.env.TAILOR_CRASH_REPORT_ENDPOINT;
    }
  });

  test("sends GraphQL mutation with variables", async () => {
    mockFetchResolvedValue({ data: { submitCrashReport: { success: true } } });
    const report = makeCrashReport();

    await sendCrashReport(report, "tailor/1.0.0");

    const call = vi.mocked(globalThis.fetch).mock.calls[0]!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body).toHaveProperty("query");
    expect(body).toHaveProperty("variables");
    expect(body.query).toContain("mutation");
    expect(body.query).toContain("submitCrashReport");
    expect(body.variables.id).toBe(report.id);
    expect(body.variables.errorName).toBe(report.errorName);
  });

  test("includes all CrashReport fields as variables", async () => {
    mockFetchResolvedValue({ data: { submitCrashReport: { success: true } } });
    const report = makeCrashReport();

    await sendCrashReport(report, "tailor/1.0.0");

    const call = vi.mocked(globalThis.fetch).mock.calls[0]!;
    const { variables } = JSON.parse(call[1]!.body as string);
    expect(variables).toEqual(report);
  });

  test.each([
    [
      "returns true when server responds with success",
      { data: { submitCrashReport: { success: true } } },
      true,
    ],
    [
      "returns false when response contains GraphQL errors",
      { errors: [{ message: "permission denied" }], data: { submitCrashReport: null } },
      false,
    ],
    [
      "returns true when server returns empty errors array",
      { errors: [], data: { submitCrashReport: { success: true } } },
      true,
    ],
    [
      "returns false when mutation returns success: false",
      { data: { submitCrashReport: { success: false } } },
      false,
    ],
  ])("%s", async (_name, response, expected) => {
    mockFetchResolvedValue(response);

    const result = await sendCrashReport(makeCrashReport(), "tailor/1.0.0");

    expect(result).toBe(expected);
  });

  test("returns false on non-ok HTTP response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    const result = await sendCrashReport(makeCrashReport(), "tailor/1.0.0");

    expect(result).toBe(false);
  });

  test("returns false on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await sendCrashReport(makeCrashReport(), "tailor/1.0.0");

    expect(result).toBe(false);
  });

  test("uses TAILOR_CRASH_REPORT_ENDPOINT env var", async () => {
    mockFetchResolvedValue({ data: { submitCrashReport: { success: true } } });

    process.env.TAILOR_CRASH_REPORT_ENDPOINT = "https://custom.example.com/query";
    await sendCrashReport(makeCrashReport(), "tailor/1.0.0");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://custom.example.com/query",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("sends Content-Type application/json and User-Agent headers", async () => {
    mockFetchResolvedValue({ data: { submitCrashReport: { success: true } } });

    await sendCrashReport(makeCrashReport(), "tailor/1.0.0");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "User-Agent": "tailor/1.0.0",
        }),
      }),
    );
  });
});
