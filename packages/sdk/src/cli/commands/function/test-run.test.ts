import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";

type MockProcedure = (...args: Parameters<Mock>) => ReturnType<Mock>;
import { initOperatorClient } from "@/cli/shared/client";
import { loadConfig } from "@/cli/shared/config-loader";
import { executeScript } from "@/cli/shared/script-executor";
import { captureStderr, captureStdout } from "@/cli/shared/test-helpers/capture-output";
import { jsonMode } from "@/cli/shared/test-helpers/json-mode";
import { testRunCommand } from "./test-run";

vi.mock("@/cli/shared/config-loader", () => ({
  loadConfig: vi.fn<MockProcedure>(),
}));

vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn<MockProcedure>().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn<MockProcedure>().mockResolvedValue("12345678-1234-4abc-8def-123456789012"),
}));

vi.mock("@/cli/shared/client", () => ({
  initOperatorClient: vi.fn<MockProcedure>(),
}));

vi.mock("@/cli/shared/script-executor", () => ({
  executeScript: vi.fn<MockProcedure>(),
}));

describe("function test-run --json", () => {
  let tmpDir: string;
  let scriptPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "function-test-run-json-test-"));
    scriptPath = path.join(tmpDir, "fn.js");
    fs.writeFileSync(scriptPath, "export default async function main() { return { ok: true }; }");

    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        auth: {
          name: "auth",
          machineUsers: {
            admin: {},
          },
        },
      },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    vi.mocked(initOperatorClient).mockResolvedValue({
      getAuthMachineUser: vi.fn<MockProcedure>().mockResolvedValue({
        machineUser: {
          id: "machine-user-id",
        },
      }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    vi.mocked(executeScript).mockResolvedValue({
      success: true,
      logs: "",
      result: '{"ok":true}',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("emits only a parseable JSON result to stdout", async () => {
    using stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(testRunCommand, [scriptPath, "--machine-user", "admin"]);

    expect(JSON.parse(stdout.output)).toEqual({
      success: true,
      scriptName: "fn.js",
      logs: "",
      result: '{"ok":true}',
    });
    expect(stderr.output).not.toBe("");
  });
});
