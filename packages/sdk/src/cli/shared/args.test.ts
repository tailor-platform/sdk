import * as fs from "node:fs";
import { arg, runCommand } from "@politty/zod";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import * as path from "pathe";
import { describe, expect, aroundEach, test, vi } from "vitest";
import { z } from "zod";
import {
  createCommonArgs,
  loadEnvFiles,
  durationArg,
  parseDuration,
  positiveIntArg,
  recoveryContextArgs,
  resolveMachineUserInputSource,
  toPageDirection,
} from "./args";
import { defineAppCommand } from "./command";
import { CIPromptError, logger } from "./logger";
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

describe("createCommonArgs effects", () => {
  test.each([
    { runnerDebug: "1", debug: undefined, argv: [], enabled: true },
    { runnerDebug: undefined, debug: "true", argv: [], enabled: true },
    { runnerDebug: "0", debug: undefined, argv: ["--verbose"], enabled: true },
    { runnerDebug: undefined, debug: undefined, argv: [], enabled: false },
    { runnerDebug: "true", debug: "false", argv: [], enabled: false },
  ])(
    "resolves verbose output from $runnerDebug / $debug / $argv",
    async ({ runnerDebug, debug, argv, enabled }) => {
      const previousVerbose = logger.verbose;
      using stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      vi.stubEnv("RUNNER_DEBUG", runnerDebug);
      vi.stubEnv("DEBUG", debug);
      try {
        logger.verbose = false;
        const command = defineAppCommand({
          name: "noop",
          description: "noop",
          run: () => logger.debug("verbosity-sentinel"),
        });
        const result = await runCommand(command, argv, {
          // Strip unknown keys the same way the CLI entrypoint parses global args.
          globalArgs: z.object(createCommonArgs()),
        });
        expect(result.exitCode).toBe(0);
        expect(logger.verbose).toBe(enabled);
        const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
        expect(output.includes("verbosity-sentinel")).toBe(enabled);
        expect(stderr).toHaveBeenCalledTimes(enabled ? 1 : 0);
      } finally {
        vi.unstubAllEnvs();
        logger.verbose = previousVerbose;
      }
    },
  );

  test("--json and --verbose set the shared logger state", async () => {
    const previousJsonMode = logger.jsonMode;
    const previousVerbose = logger.verbose;
    try {
      const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
      const result = await runCommand(command, ["--json", "--verbose"], {
        // Strip unknown keys the same way the CLI entrypoint parses global args.
        globalArgs: z.object(createCommonArgs()),
      });
      expect(result.exitCode).toBe(0);
      expect(logger.jsonMode).toBe(true);
      expect(logger.verbose).toBe(true);
    } finally {
      logger.jsonMode = previousJsonMode;
      logger.verbose = previousVerbose;
    }
  });

  test.each([
    { output: undefined, argv: [], expected: false },
    { output: "json", argv: [], expected: true },
    { output: "table", argv: [], expected: false },
    { output: "json", argv: ["--json"], expected: true },
    { output: "table", argv: ["--json"], expected: true },
    { output: "json", argv: ["--json=false"], expected: false },
    { output: "json", argv: ["--", "--json"], expected: true },
    { output: "JSON", argv: [], expected: true },
    { output: "yaml", argv: [], expected: false },
    { output: "", argv: [], expected: false },
  ])(
    "resolves JSON output from TAILOR_OUTPUT=$output with $argv",
    async ({ output, argv, expected }) => {
      const previousJsonMode = logger.jsonMode;
      const previousArgv = process.argv;
      vi.stubEnv("TAILOR_OUTPUT", output);
      try {
        logger.jsonMode = false;
        // The CLI entrypoint runs through runMain, which reads process.argv.
        process.argv = [previousArgv[0] as string, "tailor", ...argv];
        const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
        const result = await runCommand(command, argv, {
          // Strip unknown keys the same way the CLI entrypoint parses global args.
          globalArgs: z.object(createCommonArgs()),
        });
        expect(result.exitCode).toBe(0);
        expect(logger.jsonMode).toBe(expected);
      } finally {
        process.argv = previousArgv;
        vi.unstubAllEnvs();
        logger.jsonMode = previousJsonMode;
      }
    },
  );

  test.each([
    { output: "json", argv: [] as string[], expected: true },
    { output: "table", argv: [] as string[], expected: false },
    { output: undefined, argv: [] as string[], expected: false },
    { output: "json", argv: ["--json=false"], expected: false },
    { output: "table", argv: ["--json"], expected: true },
  ])(
    "passes the resolved output mode to commands as args.json ($output, $argv)",
    async ({ output, argv, expected }) => {
      const previousJsonMode = logger.jsonMode;
      const previousArgv = process.argv;
      vi.stubEnv("TAILOR_OUTPUT", output);
      let seen: unknown;
      try {
        logger.jsonMode = false;
        process.argv = [previousArgv[0] as string, "tailor", ...argv];
        const command = defineAppCommand({
          name: "noop",
          description: "noop",
          run: (args) => {
            seen = (args as { json?: boolean }).json;
          },
        });
        const result = await runCommand(command, argv, {
          // Strip unknown keys the same way the CLI entrypoint parses global args.
          globalArgs: z.object(createCommonArgs()),
        });
        expect(result.exitCode).toBe(0);
        expect(seen).toBe(expected);
      } finally {
        process.argv = previousArgv;
        vi.unstubAllEnvs();
        logger.jsonMode = previousJsonMode;
      }
    },
  );

  test.each([
    { argv: ["--json"], want: "--json", unwanted: "TAILOR_OUTPUT" },
    { argv: [] as string[], want: "TAILOR_OUTPUT", unwanted: "--json" },
  ])("a suppressed prompt names what selected JSON for $argv", async ({ argv, want, unwanted }) => {
    const previousJsonMode = logger.jsonMode;
    const previousArgv = process.argv;
    vi.stubEnv("TAILOR_OUTPUT", "json");
    try {
      logger.jsonMode = false;
      process.argv = [previousArgv[0] as string, "tailor", ...argv];
      const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
      const result = await runCommand(command, argv, {
        // Strip unknown keys the same way the CLI entrypoint parses global args.
        globalArgs: z.object(createCommonArgs()),
      });
      expect(result.exitCode).toBe(0);
      expect(logger.jsonMode).toBe(true);
      const { message } = new CIPromptError();
      expect(message).toContain(want);
      expect(message).not.toContain(unwanted);
    } finally {
      process.argv = previousArgv;
      vi.unstubAllEnvs();
      logger.jsonMode = previousJsonMode;
    }
  });

  test.each([
    {
      label: "explicit --json=false wins over the env default",
      argv: ["--json=false"],
      expected: false,
    },
    { label: "explicit --json wins over TAILOR_OUTPUT=table", argv: ["--json"], expected: true },
  ])("$label when process.argv carries no flags", async ({ argv, expected }) => {
    const previousJsonMode = logger.jsonMode;
    const previousArgv = process.argv;
    vi.stubEnv("TAILOR_OUTPUT", expected ? "table" : "json");
    try {
      logger.jsonMode = false;
      // Programmatic callers pass argv directly; process.argv belongs to the host.
      process.argv = [previousArgv[0] as string, "host"];
      const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
      const result = await runCommand(command, argv, {
        // Strip unknown keys the same way the CLI entrypoint parses global args.
        globalArgs: z.object(createCommonArgs()),
      });
      expect(result.exitCode).toBe(0);
      expect(logger.jsonMode).toBe(expected);
    } finally {
      process.argv = previousArgv;
      vi.unstubAllEnvs();
      logger.jsonMode = previousJsonMode;
    }
  });

  test.each([
    { output: "json", argv: [] as string[], expected: true },
    { output: "json", argv: ["--json=false"], expected: false },
    { output: "table", argv: ["--json"], expected: true },
  ])(
    "resolves the output mode for commands with their own args ($output, $argv)",
    async ({ output, argv, expected }) => {
      const previousJsonMode = logger.jsonMode;
      const previousArgv = process.argv;
      vi.stubEnv("TAILOR_OUTPUT", output);
      let seen: unknown;
      try {
        logger.jsonMode = false;
        // The CLI entrypoint runs through runMain, which reads process.argv.
        process.argv = [previousArgv[0] as string, "tailor", ...argv];
        const command = defineAppCommand({
          name: "noop",
          description: "noop",
          // strip unknown keys
          args: z.object({ name: arg(z.string().optional(), { description: "Name" }) }),
          run: (args) => {
            seen = (args as { json?: boolean }).json;
          },
        });
        const result = await runCommand(command, argv, {
          // Strip unknown keys the same way the CLI entrypoint parses global args.
          globalArgs: z.object(createCommonArgs()),
        });
        expect(result.exitCode).toBe(0);
        expect(seen).toBe(expected);
        expect(logger.jsonMode).toBe(expected);
      } finally {
        process.argv = previousArgv;
        vi.unstubAllEnvs();
        logger.jsonMode = previousJsonMode;
      }
    },
  );

  test.each([
    {
      label: "explicit --json=false wins over the env default",
      argv: ["--json=false"],
      want: false,
    },
    { label: "explicit --json wins over TAILOR_OUTPUT=table", argv: ["--json"], want: true },
  ])(
    "$label for a command with its own args when process.argv carries no flags",
    async ({ argv, want }) => {
      const previousJsonMode = logger.jsonMode;
      const previousArgv = process.argv;
      vi.stubEnv("TAILOR_OUTPUT", want ? "table" : "json");
      let seen: unknown;
      try {
        logger.jsonMode = false;
        // Programmatic callers pass argv directly; process.argv belongs to the host.
        process.argv = [previousArgv[0] as string, "host"];
        const command = defineAppCommand({
          name: "noop",
          description: "noop",
          // strip unknown keys
          args: z.object({ name: arg(z.string().optional(), { description: "Name" }) }),
          run: (args) => {
            seen = (args as { json?: boolean }).json;
          },
        });
        const result = await runCommand(command, argv, {
          // Strip unknown keys the same way the CLI entrypoint parses global args.
          globalArgs: z.object(createCommonArgs()),
        });
        expect(result.exitCode).toBe(0);
        expect(seen).toBe(want);
        expect(logger.jsonMode).toBe(want);
      } finally {
        process.argv = previousArgv;
        vi.unstubAllEnvs();
        logger.jsonMode = previousJsonMode;
      }
    },
  );

  test("verboseAlias adds a short alias for --verbose", async () => {
    const previousVerbose = logger.verbose;
    try {
      logger.verbose = false;
      const command = defineAppCommand({ name: "noop", description: "noop", run: () => {} });
      const result = await runCommand(command, ["-v"], {
        // Strip unknown keys the same way the plugin entrypoints parse global args.
        globalArgs: z.object(createCommonArgs({ verboseAlias: "v" })),
      });
      expect(result.exitCode).toBe(0);
      expect(logger.verbose).toBe(true);
    } finally {
      logger.verbose = previousVerbose;
    }
  });
});
