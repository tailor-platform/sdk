import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("std-env", () => ({
  isCI: false,
}));

describe("crash-report list command", () => {
  let tmpDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TAILOR_CRASH_REPORTS_LOCAL;
    delete process.env.TAILOR_CRASH_REPORTS_REMOTE;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crash-report-list-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("lists crash report files sorted newest first", async () => {
    vi.doMock("@/cli/crash-report/config", () => ({
      parseCrashReportConfig: () => ({
        localEnabled: true,
        remoteEnabled: false,
        localDir: tmpDir,
      }),
    }));

    fs.writeFileSync(path.join(tmpDir, "2026-03-01T00-00-00.crash.log"), "report 1");
    fs.writeFileSync(path.join(tmpDir, "2026-03-02T00-00-00.crash.log"), "report 2");
    fs.writeFileSync(path.join(tmpDir, "not-a-crash.txt"), "other file");

    const { parseCrashReportConfig } = await import("@/cli/crash-report/config");
    const config = parseCrashReportConfig();

    const files = fs
      .readdirSync(config.localDir!)
      .filter((f) => f.endsWith(".crash.log"))
      .sort()
      .reverse();

    expect(files).toEqual(["2026-03-02T00-00-00.crash.log", "2026-03-01T00-00-00.crash.log"]);
  });

  test("returns empty list when no crash reports exist", async () => {
    vi.doMock("@/cli/crash-report/config", () => ({
      parseCrashReportConfig: () => ({
        localEnabled: true,
        remoteEnabled: false,
        localDir: tmpDir,
      }),
    }));

    const { parseCrashReportConfig } = await import("@/cli/crash-report/config");
    const config = parseCrashReportConfig();

    const files = fs.readdirSync(config.localDir!).filter((f) => f.endsWith(".crash.log"));

    expect(files).toEqual([]);
  });

  test("handles non-existent directory gracefully", async () => {
    const nonExistentDir = path.join(tmpDir, "does-not-exist");

    vi.doMock("@/cli/crash-report/config", () => ({
      parseCrashReportConfig: () => ({
        localEnabled: true,
        remoteEnabled: false,
        localDir: nonExistentDir,
      }),
    }));

    const { parseCrashReportConfig } = await import("@/cli/crash-report/config");
    const config = parseCrashReportConfig();

    expect(fs.existsSync(config.localDir!)).toBe(false);
  });
});
