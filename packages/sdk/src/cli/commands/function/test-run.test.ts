import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "@/cli/shared/client";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadMachineUserName } from "@/cli/shared/context";
import { executeScript } from "@/cli/shared/script-executor";
import { captureStderr, captureStdout } from "@/cli/shared/test-helpers/capture-output";
import { jsonMode } from "@/cli/shared/test-helpers/json-mode";
import { testRunCommand } from "./test-run";

vi.mock("@/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("12345678-1234-4abc-8def-123456789012"),
  loadMachineUserName: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("@/cli/shared/script-executor", () => ({
  executeScript: vi.fn(),
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
      getAuthMachineUser: vi.fn().mockResolvedValue({
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

  test("uses machine user from profile default when --machine-user flag is absent", async () => {
    vi.mocked(loadMachineUserName).mockResolvedValue("profile-bot");
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(testRunCommand, [scriptPath]);

    expect(JSON.parse(stdout.output)).toMatchObject({ success: true });
  });

  test("falls back to first config machine user when profile default is absent", async () => {
    vi.mocked(loadMachineUserName).mockResolvedValue(undefined);
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(testRunCommand, [scriptPath]);

    expect(JSON.parse(stdout.output)).toMatchObject({ success: true });
  });

  test("priority: --machine-user flag > profile default > config auto-pick", async () => {
    vi.mocked(loadMachineUserName).mockResolvedValue("flag-or-profile-bot");
    const getAuthMachineUserMock = vi.fn().mockResolvedValue({
      machineUser: { id: "machine-user-id" },
    });
    vi.mocked(initOperatorClient).mockResolvedValue({
      getAuthMachineUser: getAuthMachineUserMock,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(testRunCommand, [scriptPath, "--machine-user", "flag-bot"]);

    expect(getAuthMachineUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "flag-or-profile-bot" }),
    );
  });
});
