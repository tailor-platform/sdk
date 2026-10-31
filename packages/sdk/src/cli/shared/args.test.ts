import * as fs from "node:fs";
import { arg, runCommand } from "@politty/zod";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import * as path from "pathe";
import { describe, expect, aroundEach, test, vi } from "vitest";
import { z } from "zod";
import {
  createCommonArgs,
  readEnvFileArgs,
  globalArgsApplied,
  loadEnvFiles,
  loadEnvFilesFromArgv,
  durationArg,
  parseDuration,
  positiveIntArg,
  readDeployConfigPathEnv,
  recoveryContextArgs,
  requestedJsonModeSource,
  resolveEarlyFailure,
  resolveMachineUserInputSource,
  toPageDirection,
} from "./args";
import { defineAppCommand } from "./command";
import { getErrorDiagnostics } from "./error-diagnostics";
import { CLIError } from "./errors";
import { logger } from "./logger";
import { detectedAgent, jsonMode } from "./test-helpers/json-mode";
import { tempCwd } from "./test-helpers/temp-cwd";

describe("loadEnvFiles", () => {
  const originalEnv = process.env;
  let tempDir: string;

  aroundEach(async (runTest) => {
    process.env = { ...originalEnv };
    using tmp = tempCwd("tailor-env-test-");
    tempDir = tmp.dir;
    await runTest();
    process.env = originalEnv;
  });

  describe("required env files (envFiles)", () => {
    test("loads environment variables from existing file", () => {
      const envPath = path.join(tempDir, ".env");
      fs.writeFileSync(envPath, "TEST_VAR=hello\nANOTHER_VAR=world");

      loadEnvFiles(".env", undefined);

      expect(process.env.TEST_VAR).toBe("hello");
      expect(process.env.ANOTHER_VAR).toBe("world");
    });

    test("throws error when required file does not exist", () => {
      expect(() => loadEnvFiles("nonexistent.env", undefined)).toThrow(
        /Environment file not found/,
      );
    });

    test("loads multiple files from array", () => {
      const env1Path = path.join(tempDir, ".env.1");
      const env2Path = path.join(tempDir, ".env.2");
      fs.writeFileSync(env1Path, "VAR_FROM_1=value1");
      fs.writeFileSync(env2Path, "VAR_FROM_2=value2");

      loadEnvFiles([".env.1", ".env.2"], undefined);

      expect(process.env.VAR_FROM_1).toBe("value1");
      expect(process.env.VAR_FROM_2).toBe("value2");
    });
  });

  describe("optional env files (envFilesIfExists)", () => {
    test("loads environment variables from existing file", () => {
      const envPath = path.join(tempDir, ".env.local");
      fs.writeFileSync(envPath, "LOCAL_VAR=local_value");

      loadEnvFiles(undefined, ".env.local");

      expect(process.env.LOCAL_VAR).toBe("local_value");
    });

    test("does not throw when optional file does not exist", () => {
      expect(() => loadEnvFiles(undefined, "nonexistent.env")).not.toThrow();
    });

    test("loads existing files and skips non-existing ones from array", () => {
      const envPath = path.join(tempDir, ".env.exists");
      fs.writeFileSync(envPath, "EXISTS_VAR=exists");

      loadEnvFiles(undefined, [".env.exists", ".env.missing"]);

      expect(process.env.EXISTS_VAR).toBe("exists");
    });
  });

  describe("environment variable behavior (follows Node.js --env-file since v20.7.0)", () => {
    test("does NOT overwrite pre-existing environment variables", () => {
      process.env.PREEXISTING_VAR = "original";
      const envPath = path.join(tempDir, ".env");
      fs.writeFileSync(envPath, "PREEXISTING_VAR=from_file");

      loadEnvFiles(".env", undefined);

      expect(process.env.PREEXISTING_VAR).toBe("original");
    });

    test("allows later env files to override earlier ones", () => {
      const env1Path = path.join(tempDir, ".env.1");
      const env2Path = path.join(tempDir, ".env.2");
      fs.writeFileSync(env1Path, "SHARED_VAR=from_first");
      fs.writeFileSync(env2Path, "SHARED_VAR=from_second");

      loadEnvFiles([".env.1", ".env.2"], undefined);

      expect(process.env.SHARED_VAR).toBe("from_second");
    });

    test("allows optional files to override required files", () => {
      const requiredEnv = path.join(tempDir, ".env");
      const optionalEnv = path.join(tempDir, ".env.local");
      fs.writeFileSync(requiredEnv, "SHARED_VAR=from_required");
      fs.writeFileSync(optionalEnv, "SHARED_VAR=from_optional");

      loadEnvFiles(".env", ".env.local");

      expect(process.env.SHARED_VAR).toBe("from_optional");
    });

    test("sets new variables while preserving pre-existing ones", () => {
      process.env.EXISTING = "keep_me";
      const envPath = path.join(tempDir, ".env");
      fs.writeFileSync(envPath, "EXISTING=try_to_override\nNEW_VAR=new_value");

      loadEnvFiles(".env", undefined);

      expect(process.env.EXISTING).toBe("keep_me");
      expect(process.env.NEW_VAR).toBe("new_value");
    });
  });

  describe("edge cases", () => {
    test("handles undefined for both arguments", () => {
      expect(() => loadEnvFiles(undefined, undefined)).not.toThrow();
    });

    test("handles empty arrays", () => {
      expect(() => loadEnvFiles([], [])).not.toThrow();
    });
  });
});

describe("readEnvFileArgs", () => {
  test.each([
    {
      name: "repeated flags on both sides of a subcommand",
      argv: ["--env-file", "a.env", "deploy", "-e", "b.env", "--env-file-if-exists", "c.env"],
      expected: { envFiles: ["a.env", "b.env"], envFilesIfExists: ["c.env"] },
    },
    {
      name: "inline values and camelCase spellings",
      argv: ["--env-file=a.env", "-e=b.env", "--envFile", "c.env", "--envFileIfExists=d.env"],
      expected: { envFiles: ["a.env", "b.env", "c.env"], envFilesIfExists: ["d.env"] },
    },
    {
      name: "only the flags before --",
      argv: ["-e", "a.env", "--", "-e", "b.env"],
      expected: { envFiles: ["a.env"], envFilesIfExists: [] },
    },
    {
      name: "no value from a flag followed by another option",
      argv: ["-e", "--json", "--env-file"],
      expected: { envFiles: [], envFilesIfExists: [] },
    },
    {
      name: "nothing from short-option bundles",
      argv: ["-je", "a.env", "-e.env"],
      expected: { envFiles: [], envFilesIfExists: [] },
    },
  ])("reads $name", ({ argv, expected }) => {
    expect(readEnvFileArgs(argv)).toEqual(expected);
  });
});

describe("loading env files from the command line", () => {
  const originalEnv = process.env;
  let tempDir: string;

  aroundEach(async (runTest) => {
    process.env = { ...originalEnv };
    using tmp = tempCwd("tailor-env-argv-test-");
    tempDir = tmp.dir;
    await runTest();
    process.env = originalEnv;
  });

  test("loads every file, --env-file-if-exists files after --env-file files", () => {
    fs.writeFileSync(path.join(tempDir, "a.env"), "ONLY_IN_A=a\nSHARED=a\n");
    fs.writeFileSync(path.join(tempDir, "b.env"), "SHARED=b\n");
    fs.writeFileSync(path.join(tempDir, "c.env"), "SHARED=c\n");

    loadEnvFilesFromArgv([
      "--env-file-if-exists",
      "c.env",
      "-e",
      "a.env",
      "deploy",
      "--env-file",
      "b.env",
      "--env-file-if-exists",
      "missing.env",
    ]);

    expect(process.env.ONLY_IN_A).toBe("a");
    expect(process.env.SHARED).toBe("c");
  });

  test("throws for a missing --env-file", () => {
    expect(() => loadEnvFilesFromArgv(["-e", "missing.env"])).toThrow(
      /Environment file not found: .*missing\.env/,
    );
  });

  test("loads every file after parsing when the caller did not load them first", async () => {
    fs.writeFileSync(path.join(tempDir, "a.env"), "ONLY_IN_A=a\n");
    fs.writeFileSync(path.join(tempDir, "b.env"), "ONLY_IN_B=b\n");
    let loaded: (string | undefined)[] = [];
    const command = defineAppCommand({
      name: "probe",
      args: z.strictObject({}),
      run: () => {
        loaded = [process.env.ONLY_IN_A, process.env.ONLY_IN_B];
      },
    });

    const result = await runCommand(command, ["-e", "a.env", "-e", "b.env"], {
      globalArgs: z.strictObject(createCommonArgs()),
    });

    expect(result.success).toBe(true);
    expect(loaded).toEqual(["a", "b"]);
  });
});

describe("readDeployConfigPathEnv", () => {
  test.each([
    {
      name: "reads TAILOR_CONFIG_PATH",
      env: { TAILOR_CONFIG_PATH: "a/tailor.config.ts,b/tailor.config.ts" },
      expected: "a/tailor.config.ts,b/tailor.config.ts",
      warnings: [],
    },
    {
      name: "falls back to TAILOR_PLATFORM_SDK_CONFIG_PATH with a warning",
      env: { TAILOR_PLATFORM_SDK_CONFIG_PATH: "old/tailor.config.ts" },
      expected: "old/tailor.config.ts",
      warnings: [
        ["TAILOR_PLATFORM_SDK_CONFIG_PATH is deprecated. Please use TAILOR_CONFIG_PATH instead."],
      ],
    },
    {
      name: "prefers TAILOR_CONFIG_PATH over TAILOR_PLATFORM_SDK_CONFIG_PATH",
      env: {
        TAILOR_CONFIG_PATH: "new/tailor.config.ts",
        TAILOR_PLATFORM_SDK_CONFIG_PATH: "old/tailor.config.ts",
      },
      expected: "new/tailor.config.ts",
      warnings: [],
    },
    {
      name: "treats empty values as unset",
      env: { TAILOR_CONFIG_PATH: "", TAILOR_PLATFORM_SDK_CONFIG_PATH: "" },
      expected: undefined,
      warnings: [],
    },
    {
      name: "returns undefined when neither is set",
      env: {},
      expected: undefined,
      warnings: [],
    },
  ])("$name", ({ env, expected, warnings }) => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    vi.stubEnv("TAILOR_PLATFORM_SDK_CONFIG_PATH", undefined);
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    try {
      expect(readDeployConfigPathEnv()).toBe(expected);
      expect(warnSpy.mock.calls).toEqual(warnings);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("recoveryContextArgs", () => {
  test("re-selects the workspace and profile the run used", () => {
    expect(recoveryContextArgs({ workspaceId: "ws-1", profile: "dev" })).toEqual([
      "--workspace-id=ws-1",
      "--profile=dev",
    ]);
  });

  test("omits what the run did not select", () => {
    expect(recoveryContextArgs({})).toEqual([]);
    expect(recoveryContextArgs({ profile: "dev" })).toEqual(["--profile=dev"]);
    expect(recoveryContextArgs({ workspaceId: "ws-1", profile: "" })).toEqual([
      "--workspace-id=ws-1",
    ]);
  });

  test("keeps a leading-hyphen profile bound as the option value", () => {
    expect(recoveryContextArgs({ profile: "-x" })).toEqual(["--profile=-x"]);
  });
});

describe("durationArg", () => {
  test("validates and returns duration string as-is", () => {
    expect(durationArg.parse("3s")).toBe("3s");
    expect(durationArg.parse("500ms")).toBe("500ms");
    expect(durationArg.parse("1m")).toBe("1m");
  });

  test.each(["3", "3x", "abc", ""])("rejects invalid format: %s", (value) => {
    expect(() => durationArg.parse(value)).toThrow(
      /Invalid duration format|Cannot read properties of null/,
    );
  });

  test.each(["0ms", "0s", "0m"])("rejects zero duration: %s", (value) => {
    expect(() => durationArg.parse(value)).toThrow(/Duration must be greater than 0/);
  });
});

describe("parseDuration", () => {
  test.each([
    ["3s", 3000],
    ["1s", 1000],
    ["500ms", 500],
    ["1ms", 1],
    ["1m", 60000],
    ["2m", 120000],
  ])("parses %s to %d ms", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });
});

describe("positiveIntArg", () => {
  test("parses positive integers", () => {
    expect(positiveIntArg.parse("1")).toBe(1);
    expect(positiveIntArg.parse("100")).toBe(100);
  });

  test("coerces numbers", () => {
    expect(positiveIntArg.parse(5)).toBe(5);
  });

  test("rejects zero", () => {
    expect(() => positiveIntArg.parse("0")).toThrow(/Too small/);
  });

  test("rejects negative numbers", () => {
    expect(() => positiveIntArg.parse("-1")).toThrow(/Too small/);
  });

  test("rejects non-integers", () => {
    expect(() => positiveIntArg.parse("1.5")).toThrow(/Invalid input/);
  });
});

describe("toPageDirection", () => {
  test("returns undefined when order is undefined", () => {
    expect(toPageDirection(undefined)).toBeUndefined();
  });

  test("maps asc to PageDirection.ASC", () => {
    expect(toPageDirection("asc")).toBe(PageDirection.ASC);
  });

  test("maps desc to PageDirection.DESC", () => {
    expect(toPageDirection("desc")).toBe(PageDirection.DESC);
  });
});

describe("resolveMachineUserInputSource", () => {
  aroundEach(async (runTest) => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", undefined);
    await runTest();
    vi.unstubAllEnvs();
  });

  test("returns undefined when no machine user value was parsed", () => {
    expect(resolveMachineUserInputSource(undefined, ["query"])).toBeUndefined();
  });

  test.each([
    ["long option", ["query", "--machine-user", "bot"]],
    ["long option with value", ["query", "--machine-user=bot"]],
    ["camel-case long option", ["query", "--machineUser", "bot"]],
    ["hidden alias", ["query", "--machineuser", "bot"]],
    ["short option", ["query", "-m", "bot"]],
    ["short option with value", ["query", "-m=bot"]],
  ])("reports option source for %s", (_label, argv) => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "bot");
    expect(resolveMachineUserInputSource("bot", argv)).toBe("option");
  });

  test("reports env source when value matches env and no flag is present", () => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "bot");
    expect(resolveMachineUserInputSource("bot", ["query"])).toBe("env");
  });

  test("reports option source when a positional value was explicitly provided", () => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "bot");
    expect(
      resolveMachineUserInputSource("bot", ["machineuser", "token", "bot"], {
        valueIsExplicit: true,
      }),
    ).toBe("option");
  });

  test("does not scan arguments after --", () => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "bot");
    expect(resolveMachineUserInputSource("bot", ["query", "--", "--machine-user", "bot"])).toBe(
      "env",
    );
  });
});

describe("requestedJsonModeSource", () => {
  aroundEach(async (runTest) => {
    try {
      await runTest();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test.each([
    { argv: [], env: undefined, expected: undefined },
    { argv: ["workspace", "list", "--json"], env: undefined, expected: "flag" },
    { argv: ["-j", "workspace", "list"], env: undefined, expected: "flag" },
    { argv: ["workspace", "list", "--json=true"], env: undefined, expected: "flag" },
    { argv: ["workspace", "list", "--json=false"], env: undefined, expected: undefined },
    { argv: ["workspace", "list"], env: "1", expected: "env" },
    { argv: ["workspace", "list", "--json"], env: "true", expected: "both" },
    { argv: ["workspace", "list", "--json=false"], env: "1", expected: undefined },
    { argv: ["workspace", "list"], env: "false", expected: undefined },
    { argv: ["workspace", "list", "--json", "--json=false"], env: undefined, expected: undefined },
    { argv: ["workspace", "list", "--json=yes"], env: undefined, expected: undefined },
    { argv: ["workspace", "list"], env: "yes", expected: undefined },
    { argv: ["function", "test-run", "--", "--json"], env: undefined, expected: undefined },
    { argv: ["deploy", "--no-json", "--jsonish"], env: undefined, expected: undefined },
    { argv: ["workspace", "list", "--json", "--no-json"], env: undefined, expected: undefined },
    { argv: ["--no-json", "workspace", "list", "--json"], env: undefined, expected: "flag" },
    { argv: ["workspace", "list", "--no-json"], env: "1", expected: undefined },
  ])("returns $expected for $argv with TAILOR_JSON_OUTPUT=$env", ({ argv, env, expected }) => {
    vi.stubEnv("TAILOR_JSON_OUTPUT", env);
    expect(requestedJsonModeSource(argv)).toBe(expected);
  });

  test.each([
    { argv: [], env: undefined, expected: "agent" },
    { argv: ["workspace", "list", "--json"], env: undefined, expected: "flag" },
    { argv: ["workspace", "list", "--json=false"], env: undefined, expected: undefined },
    { argv: ["workspace", "list", "--json=yes"], env: undefined, expected: undefined },
    { argv: ["workspace", "list"], env: "1", expected: "env" },
    { argv: ["workspace", "list"], env: "false", expected: undefined },
    { argv: ["workspace", "list"], env: "", expected: undefined },
    { argv: ["function", "test-run", "--", "--json=false"], env: undefined, expected: "agent" },
    { argv: ["workspace", "list", "--no-json"], env: undefined, expected: undefined },
  ])(
    "returns $expected for $argv with TAILOR_JSON_OUTPUT=$env under an AI coding agent",
    ({ argv, env, expected }) => {
      using _agent = detectedAgent("claude_code");
      vi.stubEnv("TAILOR_JSON_OUTPUT", env);
      expect(requestedJsonModeSource(argv)).toBe(expected);
    },
  );
});

describe("resolveEarlyFailure", () => {
  function resolve(error: Error, argv: string[]) {
    using _json = jsonMode(false);
    resolveEarlyFailure(error, argv);
    return { code: getErrorDiagnostics(error).code, jsonMode: logger.jsonMode };
  }

  test("names a plain argument error INVALID_ARGUMENTS under JSON output", () => {
    expect(resolve(new Error("Unknown flags: bogus"), ["--json"])).toEqual({
      code: "INVALID_ARGUMENTS",
      jsonMode: true,
    });
  });

  test("names a plain argument error INVALID_ARGUMENTS under an AI coding agent", () => {
    using _agent = detectedAgent("claude_code");
    using setJsonMode = vi.spyOn(logger, "setJsonMode");
    expect(resolve(new Error("Unknown flags: bogus"), [])).toEqual({
      code: "INVALID_ARGUMENTS",
      jsonMode: true,
    });
    expect(setJsonMode).toHaveBeenCalledWith(true, "agent");
  });

  test("leaves an argument error unnamed without JSON output", () => {
    expect(resolve(new Error("Unknown flags: bogus"), [])).toEqual({
      code: undefined,
      jsonMode: false,
    });
  });

  test.each([
    { name: "a system error", error: Object.assign(new Error("denied"), { code: "EACCES" }) },
    { name: "a TypeError", error: new TypeError("boom") },
    { name: "a CLIError", error: CLIError({ code: "PROFILE_NOT_FOUND", message: "missing" }) },
  ])("does not name $name INVALID_ARGUMENTS", ({ error }) => {
    expect(resolve(error, ["--json"]).code).toBeUndefined();
  });

  test.each([
    { runnerDebug: undefined, argv: ["--json", "--verbose"], verbose: true },
    { runnerDebug: undefined, argv: ["--verbose"], verbose: true },
    { runnerDebug: undefined, argv: ["--json", "--verbose=false"], verbose: false },
    { runnerDebug: undefined, argv: ["--json", "--verbose", "--no-verbose"], verbose: false },
    { runnerDebug: undefined, argv: ["--json"], verbose: false },
    { runnerDebug: "1", argv: ["--json"], verbose: true },
    { runnerDebug: "1", argv: ["--json", "--no-verbose"], verbose: false },
    { runnerDebug: "1", argv: ["--json", "--verbose=false"], verbose: false },
  ])(
    "applies verbose output from $argv with RUNNER_DEBUG=$runnerDebug",
    ({ runnerDebug, argv, verbose }) => {
      vi.stubEnv("DEBUG", undefined);
      vi.stubEnv("RUNNER_DEBUG", runnerDebug);
      logger.verbose = undefined;
      try {
        resolve(new Error("Unknown flags: bogus"), argv);
        expect(logger.verbose).toBe(verbose);
      } finally {
        logger.verbose = undefined;
        vi.unstubAllEnvs();
      }
    },
  );
});

describe("createCommonArgs effects", () => {
  aroundEach(async (runTest) => {
    const previousJsonMode = logger.jsonMode;
    logger.jsonMode = false;
    logger.verbose = undefined;
    try {
      await runTest();
    } finally {
      vi.unstubAllEnvs();
      logger.jsonMode = previousJsonMode;
      logger.verbose = undefined;
    }
  });

  test.each([
    { runnerDebug: "1", debug: undefined, argv: [], enabled: true },
    { runnerDebug: undefined, debug: "true", argv: [], enabled: true },
    { runnerDebug: "0", debug: undefined, argv: ["--verbose"], enabled: true },
    { runnerDebug: undefined, debug: undefined, argv: [], enabled: false },
    {
      runnerDebug: undefined,
      debug: undefined,
      argv: ["--verbose", "--no-verbose"],
      enabled: false,
    },
    { runnerDebug: "1", debug: "true", argv: ["--no-verbose"], enabled: false },
    { runnerDebug: "1", debug: "true", argv: ["--verbose=false"], enabled: false },
    { runnerDebug: "true", debug: "false", argv: [], enabled: false },
  ])(
    "resolves verbose output from $runnerDebug / $debug / $argv",
    async ({ runnerDebug, debug, argv, enabled }) => {
      using stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      vi.stubEnv("RUNNER_DEBUG", runnerDebug);
      vi.stubEnv("DEBUG", debug);
      const command = defineAppCommand({
        name: "noop",
        description: "noop",
        run: () => logger.debug("verbosity-sentinel"),
      });
      const result = await runCommand(command, argv, {
        // Parse global args the same way the CLI entrypoint does.
        globalArgs: z.strictObject(createCommonArgs()),
      });
      expect(result.exitCode).toBe(0);
      expect(logger.verbose).toBe(enabled);
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output.includes("verbosity-sentinel")).toBe(enabled);
      expect(stderr).toHaveBeenCalledTimes(enabled ? 1 : 0);
    },
  );

  test("--json and --verbose set the shared logger state", async () => {
    const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
    const result = await runCommand(command, ["--json", "--verbose"], {
      // Parse global args the same way the CLI entrypoint does.
      globalArgs: z.strictObject(createCommonArgs()),
    });
    expect(result.exitCode).toBe(0);
    expect(globalArgsApplied()).toBe(true);
    expect(logger.jsonMode).toBe(true);
    expect(logger.verbose).toBe(true);
  });

  test.each([
    { output: undefined, argv: [], expected: false },
    { output: "true", argv: [], expected: true },
    { output: "True", argv: [], expected: true },
    { output: "T", argv: [], expected: true },
    { output: "1", argv: [], expected: true },
    { output: "false", argv: [], expected: false },
    { output: "False", argv: [], expected: false },
    { output: "F", argv: [], expected: false },
    { output: "0", argv: [], expected: false },
    { output: "true", argv: ["--json"], expected: true },
    { output: "false", argv: ["--json"], expected: true },
    { output: "true", argv: ["--json=false"], expected: false },
    { output: "true", argv: ["--no-json"], expected: false },
    { output: "false", argv: ["--", "--json"], expected: false },
  ])(
    "resolves JSON output from TAILOR_JSON_OUTPUT=$output with $argv",
    async ({ output, argv, expected }) => {
      vi.stubEnv("TAILOR_JSON_OUTPUT", output);
      const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
      const result = await runCommand(command, argv, {
        // Parse global args the same way the CLI entrypoint does.
        globalArgs: z.strictObject(createCommonArgs()),
      });
      expect(result.exitCode).toBe(0);
      expect(logger.jsonMode).toBe(expected);
    },
  );

  test.each(["", "yes"])("rejects TAILOR_JSON_OUTPUT=%j", async (output) => {
    vi.stubEnv("TAILOR_JSON_OUTPUT", output);
    let ran = false;
    const command = defineAppCommand({
      name: "noop",
      description: "noop",
      run: () => {
        ran = true;
      },
    });
    const result = await runCommand(command, [], {
      // Parse global args the same way the CLI entrypoint does.
      globalArgs: z.strictObject(createCommonArgs()),
    });
    expect(result.exitCode).toBe(2);
    expect(ran).toBe(false);
  });

  test.each([
    { output: "true", argv: [] as string[], expected: true },
    { output: "false", argv: [] as string[], expected: false },
    { output: undefined, argv: [] as string[], expected: false },
    { output: "true", argv: ["--json=false"], expected: false },
    { output: "false", argv: ["--json"], expected: true },
  ])(
    "passes the output mode to commands with their own args ($output, $argv)",
    async ({ output, argv, expected }) => {
      vi.stubEnv("TAILOR_JSON_OUTPUT", output);
      let seen: unknown;
      const command = defineAppCommand({
        name: "noop",
        description: "noop",
        // Strip unknown keys.
        args: z.object({ name: arg(z.string().optional(), { description: "Name" }) }),
        run: (args) => {
          seen = (args as { json?: boolean }).json;
        },
      });
      const result = await runCommand(command, argv, {
        // Parse global args the same way the CLI entrypoint does.
        globalArgs: z.strictObject(createCommonArgs()),
      });
      expect(result.exitCode).toBe(0);
      expect(seen).toBe(expected);
      expect(logger.jsonMode).toBe(expected);
    },
  );

  test("records both JSON sources when the flag and environment enable it", async () => {
    vi.stubEnv("TAILOR_JSON_OUTPUT", "true");
    using setJsonMode = vi.spyOn(logger, "setJsonMode");
    const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
    const result = await runCommand(command, ["--json"], {
      // Parse global args the same way the CLI entrypoint does.
      globalArgs: z.strictObject(createCommonArgs()),
    });
    expect(result.exitCode).toBe(0);
    expect(setJsonMode).toHaveBeenCalledWith(true, "both");
  });

  test.each([
    { output: undefined, argv: [] as string[], expected: true },
    { output: undefined, argv: ["--json"], expected: true },
    { output: undefined, argv: ["--json=false"], expected: false },
    { output: "true", argv: [] as string[], expected: true },
    { output: "false", argv: [] as string[], expected: false },
    { output: "true", argv: ["--json=false"], expected: false },
  ])(
    "defaults to JSON under an AI coding agent unless set explicitly ($output, $argv)",
    async ({ output, argv, expected }) => {
      using _agent = detectedAgent("claude_code");
      vi.stubEnv("TAILOR_JSON_OUTPUT", output);
      let seen: unknown;
      const command = defineAppCommand({
        name: "noop",
        description: "noop",
        run: (args) => {
          seen = (args as { json?: boolean }).json;
        },
      });
      const result = await runCommand(command, argv, {
        // Parse global args the same way the CLI entrypoint does.
        globalArgs: z.strictObject(createCommonArgs()),
      });
      expect(result.exitCode).toBe(0);
      expect(seen).toBe(expected);
      expect(logger.jsonMode).toBe(expected);
    },
  );

  test.each([
    { output: undefined, argv: [] as string[], source: "agent" },
    { output: undefined, argv: ["--json"], source: "flag" },
    { output: "true", argv: [] as string[], source: "env" },
  ])(
    "records $source as what selected JSON output under an AI coding agent",
    async ({ output, argv, source }) => {
      using _agent = detectedAgent("claude_code");
      using setJsonMode = vi.spyOn(logger, "setJsonMode");
      vi.stubEnv("TAILOR_JSON_OUTPUT", output);
      const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
      const result = await runCommand(command, argv, {
        // Parse global args the same way the CLI entrypoint does.
        globalArgs: z.strictObject(createCommonArgs()),
      });
      expect(result.exitCode).toBe(0);
      expect(setJsonMode).toHaveBeenCalledWith(true, source);
    },
  );

  test("keeps table output when only politty detects an agent", async () => {
    vi.stubEnv("AI_AGENT", "claude_code");
    vi.stubEnv("POLITTY_NO_AGENT", undefined);
    const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
    const result = await runCommand(command, [], {
      // Parse global args the same way the plugin entrypoints do.
      globalArgs: z.strictObject(createCommonArgs()),
    });
    expect(result.exitCode).toBe(0);
    expect(logger.jsonMode).toBe(false);
  });

  test("verboseAlias adds a short alias for --verbose", async () => {
    const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
    const result = await runCommand(command, ["-v"], {
      // Parse global args the same way the plugin entrypoints do.
      globalArgs: z.strictObject(createCommonArgs({ verboseAlias: "v" })),
    });
    expect(result.exitCode).toBe(0);
    expect(logger.verbose).toBe(true);
  });
});
