import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseCrashReportConfig } from "@/cli/crashreport/config";
import { jsonMode } from "@/cli/shared/test-helpers/json-mode";
import { listCommand } from "./list";

vi.mock("@/cli/crashreport/config", () => ({
  parseCrashReportConfig: vi.fn(),
}));

function captureStdout() {
  let output = "";
  const spy = vi.spyOn(console, "log").mockImplementation((chunk) => {
    output += String(chunk);
  });

  return {
    get output() {
      return output;
    },
    [Symbol.dispose]() {
      spy.mockRestore();
    },
  };
}

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

    await listCommand.run({ json: true, limit: 1 } as never);

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
    using _json = jsonMode();

    await listCommand.run({ json: true } as never);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([]);
  });
});
