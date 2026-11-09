import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { watch } from "chokidar";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { CLIError } from "#/cli/shared/errors";
import { executeScriptReportingStart } from "#/cli/shared/script-executor";
import { captureStderr, captureStdoutStream } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { stripAnsi } from "#/cli/shared/test-helpers/strip-ansi";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { beginUserModuleRun } from "#/cli/shared/user-modules";
import { assertDefined } from "#/utils/assert";
import { bundleForRun } from "./bundle";
import { detectFunctionType } from "./detect";
import {
  startFunctionRunWatch,
  type FunctionRunWatch,
  type FunctionRunWatchOptions,
} from "./watch";
import type { FunctionRunTarget } from "./run-function";

vi.mock("chokidar", () => ({ watch: vi.fn() }));
vi.mock("#/cli/shared/script-executor", () => ({ executeScriptReportingStart: vi.fn() }));
vi.mock("#/cli/shared/user-modules", () => ({ beginUserModuleRun: vi.fn() }));
vi.mock("./detect", () => ({ detectFunctionType: vi.fn() }));
vi.mock("./bundle", () => ({ bundleForRun: vi.fn() }));

class FakeWatcher extends EventEmitter {
  readonly add = vi.fn();
  readonly unwatch = vi.fn();
  readonly close = vi.fn(async () => {});
}

const TIMESTAMP = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}`;

const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));

describe("startFunctionRunWatch", () => {
  let cwd: string;
  let fnPath: string;
  let watcher: FakeWatcher;
  let running: FunctionRunWatch | undefined;

  aroundEach(async (runTest) => {
    using tmp = tempCwd("function-run-watch-");
    cwd = tmp.dir;
    fnPath = path.join(cwd, "fn.ts");
    fs.writeFileSync(fnPath, "export default async () => ({});\n");
    watcher = new FakeWatcher();
    vi.mocked(watch)
      .mockReset()
      .mockImplementation(() => {
        setImmediate(() => watcher.emit("ready"));
        return watcher as never;
      });
    vi.mocked(beginUserModuleRun).mockReset();
    vi.mocked(detectFunctionType).mockReset().mockResolvedValue({ type: "plain", name: "fn" });
    vi.mocked(bundleForRun)
      .mockReset()
      .mockResolvedValue({
        bundledCode: "code",
        scriptName: "test-run--fn.js",
        sourceFiles: [fnPath],
      });
    let executions = 0;
    vi.mocked(executeScriptReportingStart)
      .mockReset()
      .mockImplementation(async (options) => {
        executions += 1;
        options.onStart?.(`exec-${executions}`);
        return { success: true, logs: "", result: '{"ok":true}' };
      });
    try {
      await runTest();
    } finally {
      await running?.close();
      running = undefined;
    }
  });

  function target(): FunctionRunTarget {
    return {
      filePath: fnPath,
      jobName: undefined,
      config: { path: path.join(cwd, "tailor.config.ts") } as FunctionRunTarget["config"],
      client: {} as FunctionRunTarget["client"],
      workspaceId: "ws-1",
      authNamespace: "auth",
      machineUser: { name: "admin", id: "mu-1", attributes: null, attributeList: [] },
    };
  }

  async function start(options: Partial<FunctionRunWatchOptions> = {}): Promise<FunctionRunWatch> {
    running = await startFunctionRunWatch({
      target: target(),
      argFile: undefined,
      initialArg: undefined,
      ...options,
    });
    return running;
  }

  async function stop(watchHandle: FunctionRunWatch): Promise<void> {
    await watchHandle.close();
    running = undefined;
  }

  function argFileFrom(stderr: string): string {
    return assertDefined(/Edit (\S+) to change/.exec(stripAnsi(stderr))?.[1], "no arg file path");
  }

  test("prints a Ready line naming a temporary argument file seeded with --arg, then runs with it", async () => {
    using stderr = captureStderr();

    await start({ initialArg: { a: 1 } });

    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(1));
    expect(stripAnsi(stderr.output)).toMatch(/Ready! .*fn\.ts.*\(\^C to quit\)/);
    const argFile = argFileFrom(stderr.output);
    expect(JSON.parse(fs.readFileSync(argFile, "utf8"))).toEqual({ a: 1 });
    expect(executeScriptReportingStart).toHaveBeenCalledWith(
      expect.objectContaining({ arg: { a: 1 } }),
    );
  });

  test("seeds the temporary argument file with {} when --arg is absent", async () => {
    using stderr = captureStderr();

    await start();

    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fs.readFileSync(argFileFrom(stderr.output), "utf8"))).toEqual({});
  });

  test("marks each run with --> and <-- lines carrying its execution ID", async () => {
    using stderr = captureStderr();
    await start();
    await vi.waitFor(() => expect(stripAnsi(stderr.output)).toContain("<--"));

    vi.mocked(executeScriptReportingStart).mockImplementationOnce(async (options) => {
      options.onStart?.("exec-2");
      return { success: false, logs: "", result: "", error: "boom" };
    });
    watcher.emit("change", fnPath);

    await vi.waitFor(() => expect(stripAnsi(stderr.output)).toContain("[FAILED]"));
    const output = stripAnsi(stderr.output);
    expect(output).toMatch(new RegExp(`^${TIMESTAMP}   --> plain "fn" \\[exec-1\\]$`, "m"));
    expect(output).toMatch(
      new RegExp(`^${TIMESTAMP}  <--  \\[OK\\] plain "fn" \\[exec-1\\]$`, "m"),
    );
    expect(output).toMatch(new RegExp(`^${TIMESTAMP}   --> plain "fn" \\[exec-2\\]$`, "m"));
    expect(output).toMatch(
      new RegExp(`^${TIMESTAMP}  <--  \\[FAILED\\] plain "fn" \\[exec-2\\]$`, "m"),
    );
    expect(output).toContain("boom");
    expect(beginUserModuleRun).toHaveBeenCalledTimes(2);
  });

  test("runs again with the new value after the argument file changes", async () => {
    using stderr = captureStderr();
    await start();
    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(1));

    const argFile = argFileFrom(stderr.output);
    fs.writeFileSync(argFile, '{"b":2}');
    watcher.emit("change", argFile);

    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(2));
    expect(executeScriptReportingStart).toHaveBeenLastCalledWith(
      expect.objectContaining({ arg: { b: 2 } }),
    );
  });

  test("reports invalid JSON in the argument file without running, and runs once it is fixed", async () => {
    using stderr = captureStderr();
    await start();
    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(1));
    const argFile = argFileFrom(stderr.output);

    fs.writeFileSync(argFile, "{broken");
    watcher.emit("change", argFile);
    await vi.waitFor(() => expect(stripAnsi(stderr.output)).toContain("[ERROR]"));
    expect(stripAnsi(stderr.output)).toMatch(
      new RegExp(`^${TIMESTAMP} {12}\\[ERROR\\] Invalid JSON in .*arg\\.json`, "m"),
    );
    expect(executeScriptReportingStart).toHaveBeenCalledTimes(1);

    fs.writeFileSync(argFile, '{"c":3}');
    watcher.emit("change", argFile);
    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(2));
    expect(executeScriptReportingStart).toHaveBeenLastCalledWith(
      expect.objectContaining({ arg: { c: 3 } }),
    );
  });

  test.each([
    [
      "detection",
      () => vi.mocked(detectFunctionType).mockRejectedValueOnce(new Error("detect boom")),
    ],
    ["bundling", () => vi.mocked(bundleForRun).mockRejectedValueOnce(new Error("bundle boom"))],
    [
      "the request",
      () => vi.mocked(executeScriptReportingStart).mockRejectedValueOnce(new Error("request boom")),
    ],
  ])("reports a failure in %s and keeps watching", async (_stage, fail) => {
    using stderr = captureStderr();
    fail();

    await start();
    await vi.waitFor(() =>
      expect(stripAnsi(stderr.output)).toMatch(
        new RegExp(`^${TIMESTAMP} {12}\\[ERROR\\] \\w+ boom$`, "m"),
      ),
    );
    watcher.emit("change", fnPath);

    await vi.waitFor(() => expect(stripAnsi(stderr.output)).toContain("<--  [OK]"));
  });

  test("prints a failure's details and suggestion under its [ERROR] line", async () => {
    using stderr = captureStderr();
    vi.mocked(detectFunctionType).mockRejectedValueOnce(
      CLIError({
        code: "WORKFLOW_JOB_AMBIGUOUS",
        message: "Multiple workflow jobs found.",
        details: 'Available jobs:\n  - "a"',
        suggestion: "Specify one with --name.",
      }),
    );

    await start();

    await vi.waitFor(() =>
      expect(stripAnsi(stderr.output)).toContain("Suggestion: Specify one with --name."),
    );
    const output = stripAnsi(stderr.output);
    expect(output).toMatch(
      new RegExp(`^${TIMESTAMP} {12}\\[ERROR\\] Multiple workflow jobs found\\.$`, "m"),
    );
    expect(output).toMatch(/^ {2}Available jobs:$/m);
  });

  test("watches the function file, the argument file, and the files the bundle read", async () => {
    using stderr = captureStderr();
    const helper = path.join(cwd, "helper.ts");
    vi.mocked(bundleForRun).mockResolvedValueOnce({
      bundledCode: "code",
      scriptName: "test-run--fn.js",
      sourceFiles: [fnPath, helper],
    });

    await start();
    await vi.waitFor(() => expect(watcher.add).toHaveBeenCalledWith([helper]));
    expect(watch).toHaveBeenCalledWith(
      expect.arrayContaining([fnPath, argFileFrom(stderr.output)]),
      expect.anything(),
    );

    vi.mocked(bundleForRun).mockRejectedValueOnce(new Error("bundle boom"));
    watcher.emit("change", helper);
    await vi.waitFor(() => expect(stripAnsi(stderr.output)).toContain("bundle boom"));
    expect(watcher.unwatch).not.toHaveBeenCalled();

    watcher.emit("change", fnPath);
    await vi.waitFor(() => expect(watcher.unwatch).toHaveBeenCalledWith([helper]));
  });

  test("runs once more after a run in flight, however many changes arrived meanwhile", async () => {
    using _stderr = captureStderr();
    let release: (() => void) | undefined;
    vi.mocked(executeScriptReportingStart).mockImplementationOnce(async (options) => {
      options.onStart?.("exec-1");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { success: true, logs: "", result: "" };
    });

    await start();
    await vi.waitFor(() => expect(release).toBeDefined());
    watcher.emit("change", fnPath);
    watcher.emit("change", fnPath);
    await settle();
    watcher.emit("change", fnPath);
    await settle();
    expect(executeScriptReportingStart).toHaveBeenCalledTimes(1);

    release?.();
    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(2));
    await settle();
    expect(executeScriptReportingStart).toHaveBeenCalledTimes(2);
  });

  test("runs again when a file is added to the project after preparing the function failed", async () => {
    using stderr = captureStderr();
    vi.mocked(detectFunctionType).mockRejectedValueOnce(new Error("detect boom"));

    await start();
    await vi.waitFor(() => expect(stripAnsi(stderr.output)).toContain("detect boom"));
    watcher.emit("add", path.join(cwd, "lib", "sum.ts"));

    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(1));
  });

  test("does not run again for a file added to the project after the function was prepared", async () => {
    using _stderr = captureStderr();
    await start();
    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(1));

    watcher.emit("add", path.join(cwd, "lib", "other.ts"));
    watcher.emit("change", path.join(cwd, "lib", "other.ts"));
    await settle();

    expect(executeScriptReportingStart).toHaveBeenCalledTimes(1);
  });

  test("watches the project directory except installed packages, dot directories, and build output", async () => {
    using stderr = captureStderr();
    vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", "build-out");
    try {
      await start();
    } finally {
      vi.unstubAllEnvs();
    }
    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(1));

    const [paths, options] = assertDefined(vi.mocked(watch).mock.calls[0], "watch not called");
    expect(paths).toContain(cwd);
    const ignored = options?.ignored as (file: string) => boolean;
    expect(ignored(path.join(cwd, "node_modules", "lib", "index.js"))).toBe(true);
    expect(ignored(path.join(cwd, ".git", "HEAD"))).toBe(true);
    expect(ignored(path.join(cwd, "build-out", "test-run", "test-run--fn.entry.js"))).toBe(true);
    expect(ignored(path.join(cwd, "lib", "sum.ts"))).toBe(false);
    expect(ignored(argFileFrom(stderr.output))).toBe(false);
  });

  test("removes the temporary argument file and its signal handlers when closed", async () => {
    using stderr = captureStderr();
    const signalHandlers = process.listeners("SIGINT");
    const watchHandle = await start();
    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(1));
    const argFile = argFileFrom(stderr.output);

    await stop(watchHandle);

    expect(fs.existsSync(path.dirname(argFile))).toBe(false);
    expect(watcher.close).toHaveBeenCalledWith();
    expect(process.listeners("SIGINT")).toEqual(signalHandlers);
  });

  test("removes the temporary argument file and exits with 0 on ^C", async () => {
    using stderr = captureStderr();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const signalHandlers = process.listeners("SIGINT");
    try {
      await start();
      await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(1));
      const onInterrupt = assertDefined(
        process.listeners("SIGINT").find((listener) => !signalHandlers.includes(listener)),
        "no SIGINT handler registered",
      );

      onInterrupt("SIGINT");

      expect(fs.existsSync(path.dirname(argFileFrom(stderr.output)))).toBe(false);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      exit.mockRestore();
    }
  });

  test("leaves a given --arg-file in place", async () => {
    using stderr = captureStderr();
    const argFile = path.join(cwd, "arg.json");
    fs.writeFileSync(argFile, '{"a":1}');

    const watchHandle = await start({ argFile });
    await vi.waitFor(() =>
      expect(executeScriptReportingStart).toHaveBeenCalledWith(
        expect.objectContaining({ arg: { a: 1 } }),
      ),
    );
    expect(argFileFrom(stderr.output)).toBe("arg.json");

    await stop(watchHandle);
    expect(fs.readFileSync(argFile, "utf8")).toBe('{"a":1}');
  });

  test("writes one JSON line per run to stdout and no arrow lines under --json", async () => {
    using stdout = captureStdoutStream();
    using stderr = captureStderr();
    using _json = jsonMode();

    await start();
    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(1));
    watcher.emit("change", fnPath);
    await vi.waitFor(() => expect(stdout.output.trim().split("\n")).toHaveLength(2));

    const records = stdout.output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    const record = {
      success: true,
      scriptName: "test-run--fn.js",
      functionType: "plain",
      functionName: "fn",
      logs: "",
      result: '{"ok":true}',
    };
    expect(records).toEqual([
      { ...record, executionId: "exec-1" },
      { ...record, executionId: "exec-2" },
    ]);
    expect(stripAnsi(stderr.output)).not.toMatch(/-->|<--/);
    expect(stripAnsi(stderr.output)).toContain("Ready!");
  });

  test("reports a failure as a JSON error envelope on stderr under --json", async () => {
    using _stdout = captureStdoutStream();
    using stderr = captureStderr();
    using _json = jsonMode();
    vi.mocked(detectFunctionType).mockRejectedValueOnce(
      CLIError({ code: "FUNCTION_TYPE_UNDETECTED", message: "Could not detect function type." }),
    );

    await start();

    await vi.waitFor(() =>
      expect(stderr.output).toContain('{"error":{"code":"FUNCTION_TYPE_UNDETECTED"'),
    );
    expect(stripAnsi(stderr.output)).not.toContain("[ERROR]");
  });

  test("warns that the argument is ignored by a resolver without input unless it is {}", async () => {
    using stderr = captureStderr();
    vi.mocked(detectFunctionType).mockResolvedValue({
      type: "resolver",
      name: "noInput",
      hasInput: false,
    });

    await start();
    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(1));
    expect(stderr.output).not.toContain("is ignored");

    const argFile = argFileFrom(stderr.output);
    fs.writeFileSync(argFile, '{"a":1}');
    watcher.emit("change", argFile);

    await vi.waitFor(() => expect(executeScriptReportingStart).toHaveBeenCalledTimes(2));
    expect(stderr.output).toContain("is ignored because this resolver has no input schema");
    expect(executeScriptReportingStart).toHaveBeenLastCalledWith(
      expect.objectContaining({ arg: undefined }),
    );
  });

  test("re-reads a pre-bundled .js file on each run", async () => {
    using _stderr = captureStderr();
    const jsPath = path.join(cwd, "fn.js");
    fs.writeFileSync(jsPath, "export const main = () => 1;");

    await start({ target: { ...target(), filePath: jsPath } });
    await vi.waitFor(() =>
      expect(executeScriptReportingStart).toHaveBeenCalledWith(
        expect.objectContaining({ code: "export const main = () => 1;" }),
      ),
    );
    expect(watch).toHaveBeenCalledWith(expect.arrayContaining([jsPath]), expect.anything());

    fs.writeFileSync(jsPath, "export const main = () => 2;");
    watcher.emit("change", jsPath);

    await vi.waitFor(() =>
      expect(executeScriptReportingStart).toHaveBeenLastCalledWith(
        expect.objectContaining({ code: "export const main = () => 2;" }),
      ),
    );
    expect(bundleForRun).not.toHaveBeenCalled();
    expect(detectFunctionType).not.toHaveBeenCalled();
  });
});
