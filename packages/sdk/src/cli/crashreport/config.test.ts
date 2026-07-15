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

  test.each([
    ["off", "off", false, false],
    ["OFF", "off", false, false],
    ["on", "on", true, true],
    ["off", "on", false, true],
  ] as const)(
    "resolves localEnabled/remoteEnabled for LOCAL=%s REMOTE=%s",
    async (local, remote, expectedLocal, expectedRemote) => {
      process.env.TAILOR_CRASH_REPORTS_LOCAL = local;
      process.env.TAILOR_CRASH_REPORTS_REMOTE = remote;

      const { parseCrashReportConfig } = await import("./config");
      const config = parseCrashReportConfig();
      expect(config.localEnabled).toBe(expectedLocal);
      expect(config.remoteEnabled).toBe(expectedRemote);
    },
  );
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
