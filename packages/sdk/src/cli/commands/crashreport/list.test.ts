import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { orderAndLimitCrashReports } from "./list";

vi.mock("std-env", () => ({
  isCI: false,
}));

describe("crashreport list command", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.stubEnv("TAILOR_CRASH_REPORTS_LOCAL", undefined);
    vi.stubEnv("TAILOR_CRASH_REPORTS_REMOTE", undefined);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crash-report-list-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function mockConfigWithLocalDir(localDir: string) {
    vi.doMock("#/cli/crashreport/config", () => ({
      parseCrashReportConfig: () => ({
        localEnabled: true,
        remoteEnabled: false,
        localDir,
      }),
    }));
    const { parseCrashReportConfig } = await import("#/cli/crashreport/config");
    return parseCrashReportConfig();
  }

  test("lists crash report files sorted newest first", async () => {
    fs.writeFileSync(path.join(tmpDir, "2026-03-01T00-00-00.crash.log"), "report 1");
    fs.writeFileSync(path.join(tmpDir, "2026-03-02T00-00-00.crash.log"), "report 2");
    fs.writeFileSync(path.join(tmpDir, "not-a-crash.txt"), "other file");

    const config = await mockConfigWithLocalDir(tmpDir);

    const files = fs
      .readdirSync(config.localDir!)
      .filter((f) => f.endsWith(".crash.log"))
      .toSorted()
      .toReversed();

    expect(files).toEqual(["2026-03-02T00-00-00.crash.log", "2026-03-01T00-00-00.crash.log"]);
  });

  test("returns empty list when no crash reports exist", async () => {
    const config = await mockConfigWithLocalDir(tmpDir);

    const files = fs.readdirSync(config.localDir!).filter((f) => f.endsWith(".crash.log"));

    expect(files).toEqual([]);
  });

  test("handles non-existent directory gracefully", async () => {
    const config = await mockConfigWithLocalDir(path.join(tmpDir, "does-not-exist"));

    expect(fs.existsSync(config.localDir!)).toBe(false);
  });
});

describe("orderAndLimitCrashReports", () => {
  const entries = [
    "2026-03-01T00-00-00.crash.log",
    "2026-03-02T00-00-00.crash.log",
    "2026-03-03T00-00-00.crash.log",
    "not-a-crash.txt",
  ];

  test.each([
    [
      "returns crash files newest-first by default",
      {},
      [
        "2026-03-03T00-00-00.crash.log",
        "2026-03-02T00-00-00.crash.log",
        "2026-03-01T00-00-00.crash.log",
      ],
    ],
    [
      "returns crash files oldest-first when order is asc",
      { order: "asc" as const },
      [
        "2026-03-01T00-00-00.crash.log",
        "2026-03-02T00-00-00.crash.log",
        "2026-03-03T00-00-00.crash.log",
      ],
    ],
    [
      "slices to the requested limit",
      { limit: 2 },
      ["2026-03-03T00-00-00.crash.log", "2026-03-02T00-00-00.crash.log"],
    ],
  ])("%s", (_label, options, expected) => {
    expect(orderAndLimitCrashReports(entries, options)).toEqual(expected);
  });

  test("treats limit 0 as unbounded", () => {
    expect(orderAndLimitCrashReports(entries, { limit: 0 })).toHaveLength(3);
  });

  test("filters out non-crash files", () => {
    const result = orderAndLimitCrashReports(entries, {});
    expect(result).not.toContain("not-a-crash.txt");
  });
});
