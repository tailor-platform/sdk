import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("std-env", () => ({
  isCI: false,
}));

describe("parseCrashReportConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TAILOR_CRASH_REPORTS_LOCAL;
    delete process.env.TAILOR_CRASH_REPORTS_REMOTE;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("returns localEnabled by default", async () => {
    const { parseCrashReportConfig } = await import("./config");
    const config = parseCrashReportConfig();
    expect(config.localEnabled).toBe(true);
    expect(config.remoteEnabled).toBe(false);
    expect(config.localDir).toContain("tailor-platform");
    expect(config.localDir).toContain("crash-reports");
  });

  test("returns disabled when TAILOR_CRASH_REPORTS_LOCAL is off", async () => {
    process.env.TAILOR_CRASH_REPORTS_LOCAL = "off";
    const { parseCrashReportConfig } = await import("./config");
    const config = parseCrashReportConfig();
    expect(config.localEnabled).toBe(false);
    expect(config.remoteEnabled).toBe(false);
  });

  test("returns disabled when TAILOR_CRASH_REPORTS_LOCAL is OFF (case insensitive)", async () => {
    process.env.TAILOR_CRASH_REPORTS_LOCAL = "OFF";
    const { parseCrashReportConfig } = await import("./config");
    const config = parseCrashReportConfig();
    expect(config.localEnabled).toBe(false);
  });

  test("returns remoteEnabled when TAILOR_CRASH_REPORTS_REMOTE is on", async () => {
    process.env.TAILOR_CRASH_REPORTS_REMOTE = "on";
    const { parseCrashReportConfig } = await import("./config");
    const config = parseCrashReportConfig();
    expect(config.localEnabled).toBe(true);
    expect(config.remoteEnabled).toBe(true);
  });

  test("remoteEnabled is independent of localEnabled", async () => {
    process.env.TAILOR_CRASH_REPORTS_LOCAL = "off";
    process.env.TAILOR_CRASH_REPORTS_REMOTE = "on";
    const { parseCrashReportConfig } = await import("./config");
    const config = parseCrashReportConfig();
    expect(config.localEnabled).toBe(false);
    expect(config.remoteEnabled).toBe(true);
  });
});

describe("parseCrashReportConfig in CI", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("returns disabled in CI environments", async () => {
    vi.doMock("std-env", () => ({
      isCI: true,
    }));
    const { parseCrashReportConfig } = await import("./config");
    const config = parseCrashReportConfig();
    expect(config.localEnabled).toBe(false);
    expect(config.remoteEnabled).toBe(false);
  });
});
