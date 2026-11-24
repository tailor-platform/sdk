import * as fs from "node:fs";
import * as os from "node:os";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadMachineUserName } from "#/cli/shared/context";
import { awaitFunctionAsyncRun, startFunctionAsyncRun } from "#/cli/shared/function-async-run";
import { executeScriptReportingStart } from "#/cli/shared/script-executor";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { sweepBeforeRun } from "#/cli/shared/workflow-run-sweep";
import { definePlugins } from "#/configure/config/index";
import { kyselyTypePlugin } from "#/plugin/builtin/kysely-type/index";
import { bundleForRun } from "./bundle";
import { detectFunctionType } from "./detect";
import { runFunctionCommand } from "./run";
import { loadScriptSchemaSnapshot, verifyScriptSchemaSnapshot } from "./script-scaffold";
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

vi.mock("#/cli/shared/function-async-run", () => ({
  startFunctionAsyncRun: vi.fn(),
  awaitFunctionAsyncRun: vi.fn(),
}));

vi.mock("#/cli/shared/workflow-run-sweep", () => ({
  sweepBeforeRun: vi.fn(),
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
    loadScriptSchemaSnapshot: vi.fn().mockReturnValue(null),
    verifyScriptSchemaSnapshot: vi.fn(),
  };
});

const asyncRun = { runId: "r00abc-xyz", name: "tmp-run-r00abc-xyz", executionId: "exec-1" };

function createClient() {
  return mockOperatorClient({
    getAuthMachineUser: {
      machineUser: {
        id: "machine-user-id",
      },
    },
  });
}

describe("function run --json", () => {
  let scriptPath: string;
  let tsScriptPath: string;
  let client: ReturnType<typeof createClient>;

  aroundEach(async (runTest) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "function-run-json-test-"));
    scriptPath = path.join(tmpDir, "fn.js");
    fs.writeFileSync(scriptPath, "export default async function main() { return { ok: true }; }");
    tsScriptPath = path.join(tmpDir, "fix.ts");
    fs.writeFileSync(tsScriptPath, "export default async function main() { return { ok: true }; }");

    vi.mocked(executeScriptReportingStart).mockClear();
    vi.mocked(loadConfig).mockClear();
    vi.mocked(startFunctionRunWatch).mockClear();
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
      plugins: [],
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    client = createClient();
    vi.mocked(initOperatorClient).mockResolvedValue(client);
    vi.mocked(executeScriptReportingStart).mockResolvedValue({
      success: true,
      logs: "",
      result: '{"ok":true}',
    });
    vi.mocked(startFunctionAsyncRun).mockReset().mockResolvedValue(asyncRun);
    vi.mocked(awaitFunctionAsyncRun)
      .mockReset()
      .mockResolvedValue({
        state: "finished",
        result: { success: true, logs: "hello", result: '{"ok":true}' },
      });
    vi.mocked(sweepBeforeRun).mockReset();
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

    expect(client.getAuthMachineUser).toHaveBeenCalledWith(
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

    expect(client.getAuthMachineUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: "admin" }),
    );
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

  describe("when the synchronous run is stopped by the Platform's time limit", () => {
    const stopped = {
      success: false,
      logs: "partial",
      result: "",
      error: "Execution timed out after 60 seconds",
    };

    test("points to the same command with --async, carrying the options it was given, in the JSON result", async () => {
      vi.mocked(executeScriptReportingStart).mockResolvedValue(stopped);
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      using stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      await runCommand(runFunctionCommand, [
        scriptPath,
        "--arg",
        '{"a":1}',
        "--machine-user",
        "admin",
        "--profile",
        "dev",
      ]);

      const { suggestion } = JSON.parse(stdout.output) as { suggestion: string };
      expect(suggestion).toContain("tailor function run");
      expect(suggestion).toContain("--async");
      expect(suggestion).toContain(`--arg '{"a":1}'`);
      expect(suggestion).toContain("--machine-user=admin");
      expect(suggestion).toContain("--profile=dev");
      expect(suggestion).not.toMatch(/\d+ seconds/);
      expect(exit).toHaveBeenCalledWith(1);
    });

    test("prints the same hint after the error when the output is for a person", async () => {
      vi.mocked(executeScriptReportingStart).mockResolvedValue(stopped);
      vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      using _stdout = captureStdout();
      using stderr = captureStderr();

      await runCommand(runFunctionCommand, [scriptPath, "--machine-user", "admin"]);

      expect(stderr.output).toContain("synchronous run");
      expect(stderr.output).toContain("--async");
    });

    test("gives no hint for a failure that is not the time limit", async () => {
      vi.mocked(executeScriptReportingStart).mockResolvedValue({
        ...stopped,
        error: "Error: boom",
      });
      vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      using stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      await runCommand(runFunctionCommand, [scriptPath, "--machine-user", "admin"]);

      expect(JSON.parse(stdout.output)).not.toHaveProperty("suggestion");
    });

    test("gives no hint when --name was given, which --async cannot be combined with", async () => {
      vi.mocked(executeScriptReportingStart).mockResolvedValue(stopped);
      vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      using stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      await runCommand(runFunctionCommand, [
        scriptPath,
        "--name",
        "job",
        "--machine-user",
        "admin",
      ]);

      expect(JSON.parse(stdout.output)).not.toHaveProperty("suggestion");
    });
  });

  describe("--async", () => {
    const runAsync = async (...extra: string[]) =>
      await runCommand(runFunctionCommand, [
        scriptPath,
        "--async",
        "--machine-user",
        "admin",
        ...extra,
      ]);

    test.each([
      { extra: ["--watch"], conflicting: "--watch" },
      { extra: ["--name", "job"], conflicting: "--name" },
    ])(
      "refuses $conflicting before anything is loaded or created",
      async ({ extra, conflicting }) => {
        using _stdout = captureStdout();
        using _stderr = captureStderr();
        using _json = jsonMode();

        const result = await runAsync(...extra);

        expect(result.error).toMatchObject({
          code: "FUNCTION_RUN_OPTIONS_CONFLICT",
          message: expect.stringContaining(conflicting),
        });
        expect(loadConfig).not.toHaveBeenCalled();
        expect(startFunctionAsyncRun).not.toHaveBeenCalled();
      },
    );

    test.each([
      { option: "--timeout", value: "30s" },
      { option: "--interval", value: "1s" },
    ])("refuses $option without --async, before anything is loaded", async ({ option, value }) => {
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      const result = await runCommand(runFunctionCommand, [
        scriptPath,
        option,
        value,
        "--machine-user",
        "admin",
      ]);

      expect(result.error).toMatchObject({
        code: "FUNCTION_RUN_OPTIONS_CONFLICT",
        message: expect.stringContaining(option),
      });
      expect(loadConfig).not.toHaveBeenCalled();
    });

    test("starts the bundled script as an asynchronous run instead of executing it synchronously", async () => {
      using stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      await runAsync("--arg", '{"a":1}');

      expect(startFunctionAsyncRun).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "12345678-1234-4abc-8def-123456789012",
          code: "export default async function main() { return { ok: true }; }",
          arg: { a: 1 },
          invoker: expect.objectContaining({ namespace: "auth", machineUserName: "admin" }),
        }),
      );
      expect(executeScriptReportingStart).not.toHaveBeenCalled();
      expect(sweepBeforeRun).toHaveBeenCalledOnce();
      expect(JSON.parse(stdout.output)).toMatchObject({
        success: true,
        result: '{"ok":true}',
        runId: asyncRun.runId,
        executionId: asyncRun.executionId,
      });
    });

    test("sweeps the resources of finished runs before it starts", async () => {
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();
      const order: string[] = [];
      vi.mocked(sweepBeforeRun).mockImplementation(async () => {
        order.push("sweep");
      });
      vi.mocked(startFunctionAsyncRun).mockImplementation(async () => {
        order.push("start");
        return asyncRun;
      });

      await runAsync();

      expect(order).toEqual(["sweep", "start"]);
    });

    test("waits without a limit and polls every 3s unless told otherwise", async () => {
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      await runAsync();

      expect(awaitFunctionAsyncRun).toHaveBeenCalledWith(
        expect.objectContaining({
          started: asyncRun,
          timeoutMs: Number.POSITIVE_INFINITY,
          pollInterval: 3000,
        }),
      );
    });

    test("waits at most as long as --timeout says, polling as often as --interval says", async () => {
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      await runAsync("--timeout", "30s", "--interval", "500ms");

      expect(awaitFunctionAsyncRun).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 30_000, pollInterval: 500 }),
      );
    });

    test("refuses a poll interval longer than a finished run is kept, before anything is created", async () => {
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      const result = await runAsync("--interval", "2m");

      expect(result.error).toMatchObject({
        code: "WORKFLOW_RUN_INTERVAL_TOO_LONG",
        command: "function run",
      });
      expect(startFunctionAsyncRun).not.toHaveBeenCalled();
    });

    test("exits with 1 when the function failed, after printing its logs", async () => {
      vi.mocked(awaitFunctionAsyncRun).mockResolvedValue({
        state: "finished",
        result: { success: false, logs: "partial", result: "", error: "Error: boom" },
      });
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      using stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      await runAsync();

      expect(JSON.parse(stdout.output)).toMatchObject({
        success: false,
        logs: "partial",
        error: "Error: boom",
      });
      expect(exit).toHaveBeenCalledWith(1);
    });

    test("stops waiting at --timeout, leaving the run going, and says how to read it and remove its resources", async () => {
      vi.mocked(awaitFunctionAsyncRun).mockResolvedValue({ state: "timedOut" });
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      const result = await runAsync("--timeout", "1s");

      expect(result.error).toMatchObject({
        code: "FUNCTION_RUN_WAIT_TIMEOUT",
        suggestion: expect.stringContaining("tailor function logs exec-1"),
        context: { runId: asyncRun.runId, executionId: asyncRun.executionId },
      });
      expect(result.error).toMatchObject({
        suggestion: expect.stringContaining("tailor workflow prune"),
      });
    });

    test("says how to find the run when Ctrl+C comes before the Platform confirmed the start", async () => {
      let release: (value: typeof asyncRun) => void = () => {};
      vi.mocked(startFunctionAsyncRun).mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      using _stdout = captureStdout();
      using stderr = captureStderr();
      using _json = jsonMode();

      const finished = runAsync();
      await vi.waitFor(() => expect(startFunctionAsyncRun).toHaveBeenCalledTimes(1));
      process.emit("SIGINT");
      release(asyncRun);
      await finished;

      expect(exit).toHaveBeenCalledWith(130);
      expect(stderr.output).toContain("may be running");
      expect(stderr.output).toContain("tailor workflow prune");
    });

    test("reports that the outcome could not be read, with where to read it", async () => {
      vi.mocked(awaitFunctionAsyncRun).mockResolvedValue({
        state: "outcomeUnavailable",
        reason: "the execution of the run was not found",
      });
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      const result = await runAsync();

      expect(result.error).toMatchObject({
        code: "FUNCTION_RUN_OUTCOME_UNAVAILABLE",
        message: expect.stringContaining("the execution of the run was not found"),
        suggestion: expect.stringContaining("tailor function logs exec-1"),
      });
    });
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
    expect(executeScriptReportingStart).not.toHaveBeenCalled();
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
    expect(client.getAuthMachineUser).toHaveBeenCalledWith(
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
