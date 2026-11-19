// oxlint-disable local/typed-operator-client-mock -- Untyped mocks; migrate them to mockOperatorClient() when editing them.
import * as fs from "node:fs";
import * as os from "node:os";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadMachineUserName } from "#/cli/shared/context";
import { executeScriptReportingStart } from "#/cli/shared/script-executor";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { definePlugins } from "#/configure/config/index";
import { kyselyTypePlugin } from "#/plugin/builtin/kysely-type/index";
import { bundleForRun } from "./bundle";
import { detectFunctionType } from "./detect";
import { runFunctionCommand, workflowRunSuggestion } from "./run";
import { checkScriptSchemaSnapshot } from "./script-scaffold";
import { startFunctionRunWatch } from "./watch";
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
  executeScriptReportingStart: vi.fn(),
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

vi.mock("./watch", () => ({
  startFunctionRunWatch: vi.fn().mockResolvedValue({ closed: Promise.resolve() }),
}));

vi.mock("./script-scaffold", async (importActual) => {
  const actual = await importActual<object>();
  return {
    ...actual,
    checkScriptSchemaSnapshot: vi.fn(),
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

    vi.mocked(executeScriptReportingStart).mockClear();
    vi.mocked(loadConfig).mockClear();
    vi.mocked(startFunctionRunWatch).mockClear();
    vi.mocked(checkScriptSchemaSnapshot).mockReset();
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
      plugins: [],
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    getAuthMachineUserMock = vi.fn().mockResolvedValue({
      machineUser: {
        id: "machine-user-id",
      },
    });
    vi.mocked(initOperatorClient).mockResolvedValue({
      getAuthMachineUser: getAuthMachineUserMock,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    vi.mocked(executeScriptReportingStart).mockResolvedValue({
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

  test("loads the config path from TAILOR_CONFIG_PATH when --config is absent", async () => {
    vi.stubEnv("TAILOR_CONFIG_PATH", "env/tailor.config.ts");
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();
    try {
      await runCommand(runFunctionCommand, [scriptPath, "--machine-user", "admin"]);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(loadConfig).toHaveBeenCalledWith("env/tailor.config.ts");
  });

  test.each([
    [["function", "test-run"]],
    [["function", "--verbose", "test-run"]],
    [["function", "-j", "test-run"]],
    [["function", "--env-file", ".env", "test-run"]],
    [["function", "-e", ".env", "test-run"]],
    [["function", "--env-file=.env", "test-run"]],
    [["function", "--envFileIfExists", ".env", "test-run"]],
    [["--json", "function", "test-run"]],
    [["--env-file", "function", "function", "test-run"]],
  ])("warns when the deprecated test-run alias is invoked as %j", async (argv) => {
    using _stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();

    const originalArgv = process.argv;
    process.argv = ["node", "tailor", ...argv, scriptPath];
    try {
      await runCommand(runFunctionCommand, [scriptPath, "--machine-user", "admin"]);
    } finally {
      process.argv = originalArgv;
    }

    expect(stderr.output).toContain("`tailor function test-run` is deprecated");
  });

  test.each([
    [["function", "run"]],
    [["function", "--env-file", "test-run"]],
    [["function", "-e", "test-run"]],
    [["function", "--envFileIfExists", "test-run"]],
    [["function", "--", "test-run"]],
  ])("does not warn when the invoked name is not the alias: %j", async (argv) => {
    using _stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();

    const originalArgv = process.argv;
    process.argv = ["node", "tailor", ...argv, scriptPath];
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

  test("bundles the script with the temporal option of the config's kyselyTypePlugin", async () => {
    const loaded = await loadConfig();
    vi.mocked(loadConfig).mockResolvedValueOnce({
      ...loaded,
      plugins: definePlugins(kyselyTypePlugin({ distPath: "./db.ts", temporal: true })),
    });
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(runFunctionCommand, [tsScriptPath, "--machine-user", "admin"]);

    expect(bundleForRun).toHaveBeenCalledWith(expect.objectContaining({ kyselyTemporal: true }));
  });

  test("checks the schema snapshot of the script before executing", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(runFunctionCommand, [tsScriptPath, "--machine-user", "admin"]);

    expect(checkScriptSchemaSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: tsScriptPath,
        allowDrift: false,
        workspaceId: "12345678-1234-4abc-8def-123456789012",
      }),
    );
    expect(JSON.parse(stdout.output)).toMatchObject({ success: true });
  });

  test("refuses to run when the schema snapshot check reports drift", async () => {
    vi.mocked(checkScriptSchemaSnapshot).mockRejectedValueOnce(new Error("Schema drift detected"));
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await runCommand(runFunctionCommand, [tsScriptPath, "--machine-user", "admin"]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/Schema drift detected/);
    expect(executeScriptReportingStart).not.toHaveBeenCalled();
  });

  test("passes --allow-schema-drift on to the snapshot check", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(runFunctionCommand, [
      tsScriptPath,
      "--machine-user",
      "admin",
      "--allow-schema-drift",
    ]);

    expect(checkScriptSchemaSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ allowDrift: true }),
    );
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

  test("keeps the wording of an invalid --arg error", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await runCommand(runFunctionCommand, [scriptPath, "--arg", "{broken"]);

    expect(result.error).toMatchObject({ code: "FUNCTION_ARG_INVALID" });
    expect(result.error?.message).toMatch(/^Invalid --arg JSON: /);
  });

  test("warns that --arg is ignored by a resolver without input, even when it is {}", async () => {
    vi.mocked(detectFunctionType).mockResolvedValueOnce({
      type: "resolver",
      name: "noInput",
      hasInput: false,
    });
    using _stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();

    await runCommand(runFunctionCommand, [tsScriptPath, "--arg", "{}"]);

    expect(stderr.output).toContain(
      '--arg is ignored because this resolver has no input schema. Define "input" in your resolver to use --arg.',
    );
  });

  describe("when the Platform stops the run for taking too long", () => {
    test("points to workflow run with the file and argument that were given", async () => {
      vi.mocked(executeScriptReportingStart).mockResolvedValueOnce({
        success: false,
        logs: "",
        result: "",
        error: "Execution timed out after 60 seconds",
      });
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      using _stdout = captureStdout();
      using stderr = captureStderr();

      await runCommand(runFunctionCommand, [
        scriptPath,
        "--arg",
        '{"from":"2026-01-01"}',
        "--machine-user",
        "admin",
      ]);

      expect(stderr.output).toContain("tailor workflow run");
      expect(stderr.output).toContain('--arg \'{"from":"2026-01-01"}\'');
      expect(exit).toHaveBeenCalledWith(1);
    });

    test("reports the same hint as suggestion in --json output", async () => {
      vi.mocked(executeScriptReportingStart).mockResolvedValueOnce({
        success: false,
        logs: "",
        result: "",
        error: "Execution timed out after 60 seconds",
      });
      vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      using stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      await runCommand(runFunctionCommand, [scriptPath, "--machine-user", "admin"]);

      expect(JSON.parse(stdout.output).suggestion).toContain("tailor workflow run");
    });

    test("stays silent when the run failed for another reason", async () => {
      vi.mocked(executeScriptReportingStart).mockResolvedValueOnce({
        success: false,
        logs: "",
        result: "",
        error: "TypeError: x is not a function",
      });
      vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      using _stdout = captureStdout();
      using stderr = captureStderr();

      await runCommand(runFunctionCommand, [scriptPath, "--machine-user", "admin"]);

      expect(stderr.output).not.toContain("workflow run");
    });

    test("names --name as --job, and leaves out options at their defaults", () => {
      expect(
        workflowRunSuggestion({
          file: "workflows/jobs.ts",
          job: "send-report",
          arg: undefined,
          argFile: "args/report.json",
          machineUser: "admin",
          config: "tailor.config.ts",
          workspaceId: undefined,
          profile: undefined,
        }),
      ).toContain(
        "`tailor workflow run workflows/jobs.ts --job send-report --arg-file args/report.json --machine-user=admin`",
      );
    });
  });

  describe("--arg-file", () => {
    test("passes the file's JSON to the function", async () => {
      const argFile = path.join(path.dirname(scriptPath), "arg.json");
      fs.writeFileSync(argFile, '{"a":1,"b":2}');
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      await runCommand(runFunctionCommand, [scriptPath, "--arg-file", argFile]);

      expect(executeScriptReportingStart).toHaveBeenCalledWith(
        expect.objectContaining({ arg: { a: 1, b: 2 } }),
      );
    });

    test("is rejected together with --arg before the config is loaded", async () => {
      const argFile = path.join(path.dirname(scriptPath), "arg.json");
      fs.writeFileSync(argFile, "{}");
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      const result = await runCommand(runFunctionCommand, [
        scriptPath,
        "--arg",
        "{}",
        "--arg-file",
        argFile,
      ]);

      expect(result.error).toMatchObject({ code: "FUNCTION_RUN_OPTIONS_CONFLICT" });
      expect(loadConfig).not.toHaveBeenCalled();
    });

    test("rejects a file that is not valid JSON before the config is loaded", async () => {
      const argFile = path.join(path.dirname(scriptPath), "arg.json");
      fs.writeFileSync(argFile, "{broken");
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      const result = await runCommand(runFunctionCommand, [scriptPath, "--arg-file", argFile]);

      expect(result.error).toMatchObject({ code: "FUNCTION_ARG_INVALID" });
      expect(result.error?.message).toContain("arg.json");
      expect(loadConfig).not.toHaveBeenCalled();
    });

    test("rejects a path it cannot read as a file", async () => {
      const argDir = path.join(path.dirname(scriptPath), "args");
      fs.mkdirSync(argDir);
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      const result = await runCommand(runFunctionCommand, [scriptPath, "--arg-file", argDir]);

      expect(result.error).toMatchObject({ code: "FUNCTION_ARG_FILE_UNREADABLE" });
      expect(result.error?.message).toContain(argDir);
    });

    test("rejects a missing file, naming it", async () => {
      const argFile = path.join(path.dirname(scriptPath), "missing.json");
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      const result = await runCommand(runFunctionCommand, [scriptPath, "--arg-file", argFile]);

      expect(result.error).toMatchObject({ code: "FILE_NOT_FOUND" });
      expect(result.error?.message).toContain(argFile);
    });

    test("warns that the file is ignored for a resolver without input", async () => {
      vi.mocked(detectFunctionType).mockResolvedValueOnce({
        type: "resolver",
        name: "noInput",
        hasInput: false,
      });
      const argFile = path.join(path.dirname(tsScriptPath), "arg.json");
      fs.writeFileSync(argFile, '{"a":1}');
      using _stdout = captureStdout();
      using stderr = captureStderr();
      using _json = jsonMode();

      await runCommand(runFunctionCommand, [tsScriptPath, "--arg-file", argFile]);

      expect(stderr.output).toMatch(
        /arg\.json is ignored because this resolver has no input schema/,
      );
      expect(executeScriptReportingStart).toHaveBeenCalledWith(
        expect.objectContaining({ arg: undefined }),
      );
    });
  });

  describe("--watch", () => {
    test("hands the function and argument options to the watch instead of running once", async () => {
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      await runCommand(runFunctionCommand, [tsScriptPath, "--watch", "--arg", '{"a":1}']);

      expect(startFunctionRunWatch).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ filePath: tsScriptPath }),
          argFile: undefined,
          initialArg: { a: 1 },
        }),
      );
      expect(executeScriptReportingStart).not.toHaveBeenCalled();
    });

    test("leaves a malformed argument file to each run, but rejects a missing one", async () => {
      const argFile = path.join(path.dirname(tsScriptPath), "arg.json");
      fs.writeFileSync(argFile, "{broken");
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      await runCommand(runFunctionCommand, [tsScriptPath, "--watch", "--arg-file", argFile]);
      const missing = await runCommand(runFunctionCommand, [
        tsScriptPath,
        "--watch",
        "--arg-file",
        path.join(path.dirname(tsScriptPath), "missing.json"),
      ]);

      expect(startFunctionRunWatch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ argFile }),
      );
      expect(missing.error).toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    test("rejects an invalid --arg before the watch starts", async () => {
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      const result = await runCommand(runFunctionCommand, [
        tsScriptPath,
        "--watch",
        "--arg",
        "{broken",
      ]);

      expect(result.error).toMatchObject({ code: "FUNCTION_ARG_INVALID" });
      expect(startFunctionRunWatch).not.toHaveBeenCalled();
    });
  });
});
