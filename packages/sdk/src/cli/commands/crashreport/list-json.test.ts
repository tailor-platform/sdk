import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseCrashReportConfig } from "#/cli/crashreport/config";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { listCommand } from "./list";
import { crashReportCommand } from ".";

vi.mock("#/cli/crashreport/config", () => ({
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

  test.each([
    ["emits an empty JSON array when the crash report directory is unavailable", listCommand],
    ["honors logger jsonMode when parent command delegates without json args", crashReportCommand],
  ] as const)("%s", async (_label, command) => {
    vi.mocked(parseCrashReportConfig).mockReturnValue({
      localEnabled: false,
      remoteEnabled: false,
      localDir: "",
    });

    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(command, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([]);
  });
});
