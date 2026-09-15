import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempCwd } from "./shared/test-helpers/temp-cwd";

const cliEntry = fileURLToPath(new URL("../../bin/tailor.mjs", import.meta.url));
const builtEntry = fileURLToPath(new URL("../../dist/cli/main.mjs", import.meta.url));

function runCli(args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 15_000,
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      XDG_CONFIG_HOME: cwd,
      XDG_CACHE_HOME: cwd,
      XDG_STATE_HOME: cwd,
      XDG_DATA_HOME: cwd,
      NODE_COMPILE_CACHE: cwd,
      TAILOR_CRASH_REPORTS_LOCAL: "off",
      TAILOR_CRASH_REPORTS_REMOTE: "off",
      NO_COLOR: "1",
      ...extraEnv,
    },
  });
}

describe("CLI error verbosity", () => {
  test.each([
    { name: "default", extraEnv: {}, args: [], stack: false },
    { name: "flag", extraEnv: {}, args: ["--verbose"], stack: true },
    { name: "runner", extraEnv: { RUNNER_DEBUG: "1" }, args: [], stack: true },
    { name: "debug", extraEnv: { DEBUG: "true" }, args: [], stack: true },
  ])(
    "preserves JSON failure context with $name verbosity",
    ({ extraEnv, args, stack }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempCwd("cli-error-verbosity-");
      const config = path.join(tmp.dir, "missing.config.ts");
      expect(existsSync(config)).toBe(false);

      const result = runCli(["generate", "--json", "--config", config, ...args], tmp.dir, extraEnv);

      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
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

describe("parent command shortcuts", () => {
  test.each([
    { parent: ["workspace"], explicit: ["workspace", "list"] },
    { parent: ["workflow"], explicit: ["workflow", "list"] },
    { parent: ["secret", "vault"], explicit: ["secret", "vault", "list"] },
    { parent: ["workspace", "app"], explicit: ["workspace", "app", "list"] },
  ])(
    "propagates default subcommand failures for `$parent`",
    ({ parent, explicit }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempCwd("cli-parent-shortcut-");

      const explicitResult = runCli([...explicit, "--json"], tmp.dir);
      expect(explicitResult.error).toBeUndefined();
      expect(explicitResult.status).toBe(1);
      expect(JSON.parse(explicitResult.stderr).error).toMatchObject({
        code: "AUTH_TOKEN_NOT_FOUND",
      });

      const parentResult = runCli([...parent, "--json"], tmp.dir);
      expect(parentResult.error).toBeUndefined();
      expect(parentResult.status).toBe(explicitResult.status);
      expect(JSON.parse(parentResult.stderr)).toEqual(JSON.parse(explicitResult.stderr));
    },
    40_000,
  );
});

describe("parent command shortcuts on success", () => {
  test.each([
    { parent: ["profile"], explicit: ["profile", "list"] },
    { parent: ["plugin"], explicit: ["plugin", "list"] },
    { parent: ["crashreport"], explicit: ["crashreport", "list"] },
  ])(
    "matches the default subcommand output for `$parent`",
    ({ parent, explicit }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempCwd("cli-parent-success-");

      const explicitResult = runCli([...explicit, "--json"], tmp.dir);
      expect(explicitResult.error).toBeUndefined();
      expect(explicitResult.status).toBe(0);

      const parentResult = runCli([...parent, "--json"], tmp.dir);
      expect(parentResult.error).toBeUndefined();
      expect(parentResult.status).toBe(0);
      expect(parentResult.stdout).toBe(explicitResult.stdout);
    },
    40_000,
  );

  test("renders help for `workspace ttl` without recursing", () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempCwd("cli-parent-ttl-");

    const result = runCli(["workspace", "ttl"], tmp.dir);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Manage when a workspace becomes prunable.");
  }, 20_000);
});

describe("plugin dispatch argument forwarding", () => {
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
      name: "a profile typed before the plugin name",
      argv: ["--profile", "alpha", "erd", "export"],
      expected: ["--profile", "alpha", "export"],
    },
    {
      name: "a preceding flag kept ahead of a trailing double dash",
      argv: ["--json", "erd", "export", "--", "--json"],
      expected: ["--json", "export", "--", "--json"],
    },
  ])(
    "forwards $name",
    ({ argv, expected }) => {
      expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(
        true,
      );
      using tmp = tempCwd("cli-plugin-forward-");
      const capture = writeProbePlugin(tmp.dir);

      const result = runCli(argv, tmp.dir, { PATH: `${tmp.dir}:${process.env.PATH ?? ""}` });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(capture, "utf8"))).toEqual(expected);
    },
    20_000,
  );

  test("answers --help itself instead of dispatching a plugin", () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempCwd("cli-plugin-help-");
    const capture = writeProbePlugin(tmp.dir);

    const result = runCli(["--help", "erd", "export"], tmp.dir, {
      PATH: `${tmp.dir}:${process.env.PATH ?? ""}`,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(existsSync(capture)).toBe(false);
  }, 20_000);
});
