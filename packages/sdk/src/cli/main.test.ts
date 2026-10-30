import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { makeTempDir, tempDir } from "./shared/test-helpers/temp-dir";

const cliEntry = fileURLToPath(new URL("../../bin/tailor.mjs", import.meta.url));
const builtEntry = fileURLToPath(new URL("../../dist/cli/main.mjs", import.meta.url));

let compileCacheDir: string;

beforeAll(() => {
  compileCacheDir = makeTempDir("cli-compile-cache-");
});

afterAll(() => {
  rmSync(compileCacheDir, { recursive: true, force: true });
});

const CLI_TIMEOUT_MS = 15_000;

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: CLI_TIMEOUT_MS,
      env: {
        PATH: process.env.PATH,
        HOME: cwd,
        XDG_CONFIG_HOME: cwd,
        XDG_CACHE_HOME: cwd,
        XDG_STATE_HOME: cwd,
        XDG_DATA_HOME: cwd,
        NODE_COMPILE_CACHE: compileCacheDir,
        TAILOR_CRASH_REPORTS_LOCAL: "off",
        TAILOR_CRASH_REPORTS_REMOTE: "off",
        NO_COLOR: "1",
        POLITTY_NO_AGENT: "1",
        ...extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status, signal) => {
      if (status === null) {
        const reason = child.killed
          ? `exceeded the ${CLI_TIMEOUT_MS}ms timeout`
          : `was killed by ${signal}`;
        reject(new Error(`tailor ${args.join(" ")} ${reason}\n${stderr}`));
        return;
      }
      resolve({ status, stdout, stderr });
    });
  });
}

describe.concurrent("CLI error verbosity", () => {
  test.each([
    { name: "default", extraEnv: {}, args: [], stack: false },
    { name: "flag", extraEnv: {}, args: ["--verbose"], stack: true },
    { name: "negated flag", extraEnv: {}, args: ["--verbose", "--no-verbose"], stack: false },
    { name: "runner", extraEnv: { RUNNER_DEBUG: "1" }, args: [], stack: true },
    { name: "debug", extraEnv: { DEBUG: "true" }, args: [], stack: true },
    {
      name: "negated flag over runner and debug",
      extraEnv: { RUNNER_DEBUG: "1", DEBUG: "true" },
      args: ["--no-verbose"],
      stack: false,
    },
  ])(
    "preserves JSON failure context with $name verbosity",
    async ({ extraEnv, args, stack }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempDir("cli-error-verbosity-");
      const config = path.join(tmp.dir, "missing.config.ts");
      expect(existsSync(config)).toBe(false);

      const result = await runCli(
        ["generate", "--json", "--config", config, ...args],
        tmp.dir,
        extraEnv,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      const envelope = JSON.parse(result.stderr);
      expect(envelope.error).toMatchObject({
        code: "UNEXPECTED_ERROR",
        message: `Configuration file not found: ${config}`,
      });
      expect(
        envelope.error.stack?.includes(`Error: Configuration file not found: ${config}`) ?? false,
      ).toBe(stack);
      expect(Object.hasOwn(envelope.error, "stack")).toBe(stack);
    },
    20_000,
  );
});

describe.concurrent("argument errors under JSON output", () => {
  test.each([
    { name: "--json", args: ["--json"], extraEnv: {} },
    { name: "-j", args: ["-j"], extraEnv: {} },
    { name: "TAILOR_JSON_OUTPUT", args: [], extraEnv: { TAILOR_JSON_OUTPUT: "1" } },
  ])(
    "reports an unknown flag as INVALID_ARGUMENTS with $name",
    async ({ args, extraEnv }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempDir("cli-argument-error-json-");

      const result = await runCli(["workspace", "list", "--bogus", ...args], tmp.dir, extraEnv);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        error: { code: "INVALID_ARGUMENTS", message: "Unknown flags: bogus" },
      });
    },
    20_000,
  );

  test("reports a schema validation failure as INVALID_ARGUMENTS", async () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempDir("cli-argument-error-json-");

    const result = await runCli(["workspace", "list", "--limit", "abc", "--json"], tmp.dir);

    expect(result.status).toBe(2);
    const envelope = JSON.parse(result.stderr);
    expect(envelope.error.code).toBe("INVALID_ARGUMENTS");
    expect(envelope.error.message).toContain("limit");
  }, 20_000);

  test("keeps a plain-text argument error when JSON output is explicitly disabled", async () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempDir("cli-argument-error-json-");

    const result = await runCli(["workspace", "list", "--bogus", "--json=false"], tmp.dir, {
      TAILOR_JSON_OUTPUT: "1",
    });

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("✖ Unknown flags: bogus");
  }, 20_000);

  test("keeps the plain-text argument error without JSON output", async () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempDir("cli-argument-error-json-");

    const result = await runCli(["workspace", "list", "--bogus"], tmp.dir);

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("✖ Unknown flags: bogus");
  }, 20_000);

  test("includes the stack trace for an argument error with --verbose", async () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempDir("cli-argument-error-json-");

    const result = await runCli(["workspace", "list", "--bogus", "--json", "--verbose"], tmp.dir);

    expect(result.status).toBe(2);
    const envelope = JSON.parse(result.stderr);
    expect(envelope.error.code).toBe("INVALID_ARGUMENTS");
    expect(envelope.error.stack).toContain("Error: Unknown flags: bogus");
  }, 20_000);

  test("keeps the argument error annotation title without JSON output", async () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempDir("cli-argument-error-json-");

    const result = await runCli(["workspace", "list", "--bogus"], tmp.dir, {
      GITHUB_ACTIONS: "true",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toBe(
      "✖ Unknown flags: bogus\n::error title=Error::Unknown flags: bogus\n",
    );
  }, 20_000);
});

describe.concurrent("options given to a command group without a subcommand", () => {
  test.each([
    { name: "`--json=yes`", args: ["--json=yes"], extraEnv: {} },
    { name: "`TAILOR_JSON_OUTPUT=maybe`", args: [], extraEnv: { TAILOR_JSON_OUTPUT: "maybe" } },
    { name: "`tailordb --json=yes`", args: ["tailordb", "--json=yes"], extraEnv: {} },
  ])(
    "rejects an invalid option value with exit 2 for $name",
    async ({ args, extraEnv }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempDir("cli-group-options-");

      const result = await runCli(args, tmp.dir, extraEnv);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe("✖ json: Invalid input: expected boolean, received string");
    },
    20_000,
  );

  test.each([
    { name: "`--bogus`", args: ["--bogus"] },
    { name: "`tailordb --bogus`", args: ["tailordb", "--bogus"] },
    { name: "`workspace --bogus`", args: ["workspace", "--bogus"] },
    { name: "`workspace ttl --bogus`", args: ["workspace", "ttl", "--bogus"] },
    { name: "`plugin --bogus`", args: ["plugin", "--bogus"] },
  ])(
    "rejects an unknown option with exit 2 for $name",
    async ({ args }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempDir("cli-group-options-");

      const result = await runCli(args, tmp.dir);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe("✖ Unknown flags: bogus");
    },
    20_000,
  );

  test("suggests a mistyped subcommand followed by an option", async () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempDir("cli-group-options-");

    const result = await runCli(["deplyo", "--dry-run"], tmp.dir);

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("✖ Unknown subcommand: deplyo. Did you mean: deploy?");
  }, 20_000);
});

describe.concurrent("output under an AI coding agent", () => {
  const agentEnv = { AI_AGENT: "claude_code", POLITTY_NO_AGENT: undefined };

  test.each([
    { name: "a detected agent", extraEnv: agentEnv, args: [], json: true },
    {
      name: "a detected agent and TAILOR_JSON_OUTPUT=false",
      extraEnv: { ...agentEnv, TAILOR_JSON_OUTPUT: "false" },
      args: [],
      json: false,
    },
    {
      name: "a detected agent and --json=false",
      extraEnv: agentEnv,
      args: ["--json=false"],
      json: false,
    },
    {
      name: "a detected agent and --no-json",
      extraEnv: agentEnv,
      args: ["--no-json"],
      json: false,
    },
    {
      name: "agent detection turned off",
      extraEnv: { AI_AGENT: "claude_code", POLITTY_NO_AGENT: "1" },
      args: [],
      json: false,
    },
    { name: "no agent", extraEnv: {}, args: [], json: false },
  ])(
    "prints JSON only by default with $name",
    async ({ extraEnv, args, json }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempDir("cli-agent-output-");

      const result = await runCli(["profile", "list", ...args], tmp.dir, extraEnv);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(json ? "[]\n" : "");
    },
    20_000,
  );

  test("reports an argument error as a JSON envelope", async () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempDir("cli-agent-output-");

    const result = await runCli(["workspace", "list", "--bogus"], tmp.dir, agentEnv);

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual({
      error: { code: "INVALID_ARGUMENTS", message: "Unknown flags: bogus" },
    });
  }, 20_000);

  test.each([
    { name: "a detected agent", extraEnv: agentEnv, shown: true },
    { name: "no agent", extraEnv: {}, shown: false },
  ])(
    "shows agent guidance in --help only for $name",
    async ({ extraEnv, shown }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempDir("cli-agent-help-");

      const result = await runCli(["workspace", "--help"], tmp.dir, extraEnv);

      expect(result.status).toBe(0);
      expect(result.stdout.includes("--help-json")).toBe(true);
      expect(result.stdout.includes("docs/cli-reference.md")).toBe(shown);
    },
    20_000,
  );
});

describe.concurrent("parent command shortcuts", () => {
  test.each([
    { parent: ["workspace"], explicit: ["workspace", "list"] },
    { parent: ["workflow"], explicit: ["workflow", "list"] },
    { parent: ["secret", "vault"], explicit: ["secret", "vault", "list"] },
    { parent: ["workspace", "app"], explicit: ["workspace", "app", "list"] },
  ])(
    "propagates default subcommand failures for `$parent`",
    async ({ parent, explicit }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempDir("cli-parent-shortcut-");

      const explicitResult = await runCli([...explicit, "--json"], tmp.dir);
      expect(explicitResult.status).toBe(1);
      expect(JSON.parse(explicitResult.stderr).error).toMatchObject({
        code: "AUTH_TOKEN_NOT_FOUND",
      });

      const parentResult = await runCli([...parent, "--json"], tmp.dir);
      expect(parentResult.status).toBe(explicitResult.status);
      expect(JSON.parse(parentResult.stderr)).toEqual(JSON.parse(explicitResult.stderr));
    },
    40_000,
  );
});

describe.concurrent("parent command shortcuts on success", () => {
  test.each([
    { parent: ["profile"], explicit: ["profile", "list"] },
    { parent: ["plugin"], explicit: ["plugin", "list"] },
    { parent: ["crashreport"], explicit: ["crashreport", "list"] },
  ])(
    "matches the default subcommand output for `$parent`",
    async ({ parent, explicit }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempDir("cli-parent-success-");

      const explicitResult = await runCli([...explicit, "--json"], tmp.dir);
      expect(explicitResult.status).toBe(0);

      const parentResult = await runCli([...parent, "--json"], tmp.dir);
      expect(parentResult.status).toBe(0);
      expect(parentResult.stdout).toBe(explicitResult.stdout);
    },
    40_000,
  );

  test("renders help for `workspace ttl` without recursing", async () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempDir("cli-parent-ttl-");

    const result = await runCli(["workspace", "ttl"], tmp.dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Manage when a workspace becomes prunable.");
  }, 20_000);
});

describe.concurrent("plugin dispatch argument forwarding", () => {
  /**
   * Writes a `tailor-erd` probe into `dir` that records the argv it receives.
   * The caller prepends `dir` to PATH so plugin resolution finds it.
   * @param dir - Directory to place the probe in
   * @returns Path of the JSON file the probe writes its argv to
   */
  function writeProbePlugin(dir: string): string {
    const capture = path.join(dir, "argv.json");
    const probe = path.join(dir, "tailor-erd");
    writeFileSync(
      probe,
      `#!/usr/bin/env node\n` +
        `require("node:fs").writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)));\n`,
    );
    chmodSync(probe, 0o755);
    return capture;
  }

  test.each([
    {
      name: "a global flag typed before the plugin name",
      argv: ["--json", "erd", "export"],
      expected: ["--json", "export"],
    },
    {
      name: "flags on both sides of the plugin name",
      argv: ["--json", "erd", "export", "--verbose"],
      expected: ["--json", "export", "--verbose"],
    },
    {
      name: "a preceding flag kept ahead of a trailing double dash",
      argv: ["--json", "erd", "export", "--", "--json"],
      expected: ["--json", "export", "--", "--json"],
    },
  ])(
    "forwards $name",
    async ({ argv, expected }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempDir("cli-plugin-forward-");
      const capture = writeProbePlugin(tmp.dir);

      const result = await runCli(argv, tmp.dir, { PATH: `${tmp.dir}:${process.env.PATH ?? ""}` });

      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(capture, "utf8"))).toEqual(expected);
    },
    20_000,
  );

  test("answers --help itself instead of dispatching a plugin", async () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempDir("cli-plugin-help-");
    const capture = writeProbePlugin(tmp.dir);

    const result = await runCli(["--help", "erd", "export"], tmp.dir, {
      PATH: `${tmp.dir}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(0);
    expect(existsSync(capture)).toBe(false);
  }, 20_000);
});

describe("notification banner wiring", () => {
  // Spawned children have no TTY, so this covers the non-interactive gate end to end: the
  // banner must not read or touch its state, create a config, or change the command's outcome.
  // The interactive paths (lookup failure, pending lookup, throttling) are unit-tested in
  // notification-banner/index.test.ts.
  test("a non-interactive run leaves the banner state and the config alone", async () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempDir("cli-banner-");
    const stateDir = path.join(tmp.dir, "tailor-platform");
    const stateFile = path.join(stateDir, "notification-banner.json");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(stateFile, "{not json");

    const result = await runCli(["workspace", "list", "--limit", "abc"], tmp.dir, {
      TAILOR_PLATFORM_URL: "http://127.0.0.1:1",
      TAILOR_PLATFORM_TOKEN: "token",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("limit");
    expect(result.stderr).not.toContain("notification");
    expect(readFileSync(stateFile, "utf8")).toBe("{not json");
    expect(existsSync(path.join(stateDir, "config.yaml"))).toBe(false);
  }, 20_000);
});
