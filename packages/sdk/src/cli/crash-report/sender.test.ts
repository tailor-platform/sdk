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
    argv: ["node", "tailor-sdk", "apply"],
    errorName: "TypeError",
    errorMessage: "Cannot read properties of undefined",
    stackTrace: "TypeError: Cannot read properties of undefined",
    crashType: "handledError",
  };
}

describe("sendCrashReport", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns true on successful response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    const result = await sendCrashReport(makeCrashReport(), "tailor-sdk/1.0.0");

    expect(result).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("tailor.wiki"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "User-Agent": "tailor-sdk/1.0.0",
        }),
      }),
    );
  });

  test("returns false on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const result = await sendCrashReport(makeCrashReport(), "tailor-sdk/1.0.0");

    expect(result).toBe(false);
  });

  test("returns false on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await sendCrashReport(makeCrashReport(), "tailor-sdk/1.0.0");

    expect(result).toBe(false);
  });

  test("sends JSON body with crash report data", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    const report = makeCrashReport();

    await sendCrashReport(report, "tailor-sdk/1.0.0");

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(call[1]!.body as string) as CrashReport;
    expect(body.id).toBe(report.id);
    expect(body.errorName).toBe(report.errorName);
  });
});
