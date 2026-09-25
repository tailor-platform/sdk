import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { parseCrashReportConfig } from "./config";
import { reportCrash } from "./index";

vi.mock("std-env", () => ({
  isCI: false,
}));

vi.mock("./config", () => ({
  parseCrashReportConfig: vi.fn(),
}));

describe("reportCrash", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  aroundEach(async (runTest) => {
    process.env = { ...originalEnv };
    delete process.env.TAILOR_CRASH_REPORTS_LOCAL;
    delete process.env.TAILOR_CRASH_REPORTS_REMOTE;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crash-report-index-test-"));
    await runTest();
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.mocked(parseCrashReportConfig).mockReset();
    vi.unstubAllGlobals();
  });

  test("writes a crash log file for unexpected errors", async () => {
    vi.mocked(parseCrashReportConfig).mockReturnValue({
      localEnabled: true,
      remoteEnabled: false,
      localDir: tmpDir,
    });
    await reportCrash(new Error("unexpected boom"), "handledError");

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".crash.log"));
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(tmpDir, files[0]!), "utf-8");
    expect(content).toContain("unexpected boom");
  });

  test("does not write when disabled", async () => {
    vi.mocked(parseCrashReportConfig).mockReturnValue({
      localEnabled: false,
      remoteEnabled: false,
      localDir: tmpDir,
    });
    await reportCrash(new Error("should not write"), "handledError");

    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBe(0);
  });

  test("sends full crash report when remoteEnabled", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { submitCrashReport: { success: true } } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    vi.mocked(parseCrashReportConfig).mockReturnValue({
      localEnabled: true,
      remoteEnabled: true,
      localDir: tmpDir,
    });
    await reportCrash(new Error("send me"), "handledError");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("erp.dev/query"),
      expect.objectContaining({ method: "POST" }),
    );

    const call = mockFetch.mock.calls[0]!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body).toHaveProperty("query");
    expect(body.query).toContain("submitCrashReport");
    const { variables } = body;
    expect(variables).toHaveProperty("id");
    expect(variables).toHaveProperty("errorName");
    expect(variables).toHaveProperty("errorType", "handledError");
    expect(variables).toHaveProperty("errorMessage");
    expect(variables).toHaveProperty("stackTrace");
  });

  test("never throws even if writing fails", async () => {
    vi.mocked(parseCrashReportConfig).mockReturnValue({
      localEnabled: true,
      remoteEnabled: false,
      localDir: "/nonexistent/\0/invalid-path",
    });
    await expect(reportCrash(new Error("test"), "handledError")).resolves.toBeUndefined();
  });
});
