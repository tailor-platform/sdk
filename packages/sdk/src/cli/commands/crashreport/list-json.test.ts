import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseCrashReportConfig } from "#src/cli/crashreport/config";
import { captureStderr, captureStdout } from "#src/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#src/cli/shared/test-helpers/json-mode";
import { listCommand } from "./list";
import { crashReportCommand } from ".";

vi.mock("#src/cli/crashreport/config", () => ({
  parseCrashReportConfig: vi.fn(),
}));

describe("crashreport list --json", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crash-report-list-json-test-"));
    vi.mocked(parseCrashReportConfig).mockReturnValue({
      localEnabled: true,
      remoteEnabled: false,
      localDir: tmpDir,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("emits a parseable JSON array of crash report files", async () => {
    fs.writeFileSync(path.join(tmpDir, "2026-03-01T00-00-00.crash.log"), "report 1");
    fs.writeFileSync(path.join(tmpDir, "2026-03-02T00-00-00.crash.log"), "report 2");

    using stdout = captureStdout();
    using _json = jsonMode();

    await runCommand(listCommand, ["--limit", "1"]);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([
      {
        file: "2026-03-02T00-00-00.crash.log",
        path: path.join(tmpDir, "2026-03-02T00-00-00.crash.log"),
      },
    ]);
  });

  test("emits an empty JSON array when the crash report directory is unavailable", async () => {
    vi.mocked(parseCrashReportConfig).mockReturnValue({
      localEnabled: false,
      remoteEnabled: false,
      localDir: "",
    });

    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(listCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([]);
  });

  test("honors logger jsonMode when parent command delegates without json args", async () => {
    vi.mocked(parseCrashReportConfig).mockReturnValue({
      localEnabled: false,
      remoteEnabled: false,
      localDir: "",
    });

    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(crashReportCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([]);
  });
});
