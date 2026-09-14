import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
  ])("matches the default subcommand output for `$parent`", ({ parent, explicit }) => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempCwd("cli-parent-success-");

    const explicitResult = runCli([...explicit, "--json"], tmp.dir);
    expect(explicitResult.error).toBeUndefined();
    expect(explicitResult.status).toBe(0);

    const parentResult = runCli([...parent, "--json"], tmp.dir);
    expect(parentResult.error).toBeUndefined();
    expect(parentResult.status).toBe(0);
    expect(parentResult.stdout).toBe(explicitResult.stdout);
  });

  test("renders help for `workspace ttl` without recursing", () => {
    expect(existsSync(builtEntry), "Build the SDK before running CLI subprocess tests").toBe(true);
    using tmp = tempCwd("cli-parent-ttl-");

    const result = runCli(["workspace", "ttl"], tmp.dir);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Manage when a workspace becomes prunable.");
  });
});
