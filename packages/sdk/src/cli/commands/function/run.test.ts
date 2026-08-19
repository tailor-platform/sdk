import * as fs from "node:fs";
import * as os from "node:os";
import { runCommand } from "@politty/valibot";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadMachineUserName } from "#/cli/shared/context";
import { executeScript } from "#/cli/shared/script-executor";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { runFunctionCommand } from "./run";
import { loadScriptSchemaSnapshot, verifyScriptSchemaSnapshot } from "./script-scaffold";
import { functionCommand } from "./index";

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("12345678-1234-4abc-8def-123456789012"),
  loadMachineUserName: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/script-executor", () => ({
  executeScript: vi.fn(),
}));

vi.mock("./detect", () => ({
  detectFunctionType: vi.fn().mockResolvedValue({ type: "plain", name: "main", hasInput: false }),
}));

vi.mock("./bundle", () => ({
  bundleForRun: vi.fn().mockResolvedValue({
    bundledCode: "export const main = async () => ({});",
    scriptName: "main.js",
  }),
}));

vi.mock("./script-scaffold", async (importActual) => {
  const actual = await importActual<object>();
  return {
    ...actual,
    loadScriptSchemaSnapshot: vi.fn().mockReturnValue(null),
    verifyScriptSchemaSnapshot: vi.fn(),
  };
});

describe("function run --json", () => {
  let scriptPath: string;
  let tsScriptPath: string;
  let getAuthMachineUserMock: ReturnType<typeof vi.fn>;

  aroundEach(async (runTest) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "function-run-json-test-"));
    scriptPath = path.join(tmpDir, "fn.js");
    fs.writeFileSync(scriptPath, "export default async function main() { return { ok: true }; }");
    tsScriptPath = path.join(tmpDir, "fix.ts");
    fs.writeFileSync(tsScriptPath, "export default async function main() { return { ok: true }; }");

    vi.mocked(executeScript).mockClear();
    vi.mocked(verifyScriptSchemaSnapshot).mockReset();
    vi.mocked(loadScriptSchemaSnapshot).mockReset().mockReturnValue(null);
    vi.mocked(loadMachineUserName).mockResolvedValue(undefined);
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        path: path.join(tmpDir, "tailor.config.ts"),
        auth: {
          name: "auth",
          machineUsers: {
            admin: {},
          },
        },
      },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    getAuthMachineUserMock = vi.fn().mockResolvedValue({
      machineUser: {
        id: "machine-user-id",
      },
    });
    vi.mocked(initOperatorClient).mockResolvedValue({
      getAuthMachineUser: getAuthMachineUserMock,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    vi.mocked(executeScript).mockResolvedValue({
      success: true,
      logs: "",
      result: '{"ok":true}',
    });
    await runTest();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("emits only a parseable JSON result to stdout", async () => {
    using stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(runFunctionCommand, [scriptPath, "--machine-user", "admin"]);

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

    await runCommand(runFunctionCommand, [scriptPath]);

    expect(getAuthMachineUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "profile-bot" }),
    );
    expect(JSON.parse(stdout.output)).toMatchObject({ success: true });
  });

  test("falls back to first config machine user when profile default is absent", async () => {
    vi.mocked(loadMachineUserName).mockResolvedValue(undefined);
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(runFunctionCommand, [scriptPath]);

    expect(getAuthMachineUserMock).toHaveBeenCalledWith(expect.objectContaining({ name: "admin" }));
    expect(JSON.parse(stdout.output)).toMatchObject({ success: true });
  });

  test("warns when invoked via the deprecated test-run alias", async () => {
    using _stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();

    const originalArgv = process.argv;
    process.argv = ["node", "tailor", "function", "test-run", scriptPath];
    try {
      await runCommand(runFunctionCommand, [scriptPath, "--machine-user", "admin"]);
    } finally {
      process.argv = originalArgv;
    }

    expect(stderr.output).toContain("`tailor function test-run` is deprecated");
  });

  test("does not warn when invoked via the run command name", async () => {
    using _stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();

    const originalArgv = process.argv;
    process.argv = ["node", "tailor", "function", "run", scriptPath];
    try {
      await runCommand(runFunctionCommand, [scriptPath, "--machine-user", "admin"]);
    } finally {
      process.argv = originalArgv;
    }

    expect(stderr.output).not.toContain("deprecated");
  });

  test("dispatches the deprecated test-run alias to the run command", async () => {
    using stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();

    const originalArgv = process.argv;
    process.argv = ["node", "tailor", "function", "test-run", scriptPath];
    try {
      await runCommand(functionCommand, ["test-run", scriptPath, "--machine-user", "admin"]);
    } finally {
      process.argv = originalArgv;
    }

    expect(JSON.parse(stdout.output)).toMatchObject({ success: true });
    expect(stderr.output).toContain("`tailor function test-run` is deprecated");
  });

  test("verifies the schema snapshot of a scaffolded script before executing", async () => {
    const sidecar = { snapshotPath: "/tmp/db.snapshot.json", snapshot: { namespace: "tailordb" } };
    vi.mocked(loadScriptSchemaSnapshot).mockReturnValueOnce(sidecar as never);
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(runFunctionCommand, [tsScriptPath, "--machine-user", "admin"]);

    expect(verifyScriptSchemaSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ sidecar, workspaceId: "12345678-1234-4abc-8def-123456789012" }),
    );
    expect(JSON.parse(stdout.output)).toMatchObject({ success: true });
  });

  test("refuses to run when the schema snapshot check reports drift", async () => {
    vi.mocked(loadScriptSchemaSnapshot).mockReturnValueOnce({
      snapshotPath: "/tmp/db.snapshot.json",
      snapshot: { namespace: "tailordb" },
    } as never);
    vi.mocked(verifyScriptSchemaSnapshot).mockRejectedValueOnce(new Error("Schema drift detected"));
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await runCommand(runFunctionCommand, [tsScriptPath, "--machine-user", "admin"]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/Schema drift detected/);
    expect(executeScript).not.toHaveBeenCalled();
  });

  test("skips the schema snapshot check with --allow-schema-drift, even when the sidecar cannot be loaded", async () => {
    fs.writeFileSync(path.join(path.dirname(tsScriptPath), "db.snapshot.json"), "{broken");
    vi.mocked(loadScriptSchemaSnapshot).mockImplementation(() => {
      throw new Error("Failed to parse schema snapshot");
    });
    using stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(runFunctionCommand, [
      tsScriptPath,
      "--machine-user",
      "admin",
      "--allow-schema-drift",
    ]);

    expect(loadScriptSchemaSnapshot).not.toHaveBeenCalled();
    expect(verifyScriptSchemaSnapshot).not.toHaveBeenCalled();
    expect(stderr.output).toContain("Skipping the schema snapshot check");
    expect(JSON.parse(stdout.output)).toMatchObject({ success: true });
  });

  test("forwards the --machine-user flag to machine user resolution and uses the resolved name", async () => {
    vi.mocked(loadMachineUserName).mockResolvedValue("flag-or-profile-bot");

    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(runFunctionCommand, [scriptPath, "--machine-user", "flag-bot"]);

    expect(loadMachineUserName).toHaveBeenCalledWith(
      expect.objectContaining({ machineUser: "flag-bot", machineUserSource: "option" }),
    );
    expect(getAuthMachineUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "flag-or-profile-bot" }),
    );
  });
});
