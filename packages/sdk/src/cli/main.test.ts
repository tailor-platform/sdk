import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempCwd } from "./shared/test-helpers/temp-cwd";

const cliEntry = fileURLToPath(new URL("../../bin/tailor.mjs", import.meta.url));
const builtEntry = fileURLToPath(new URL("../../dist/cli/main.mjs", import.meta.url));

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

      const result = spawnSync(
        process.execPath,
        [cliEntry, "generate", "--json", "--config", config, ...args],
        {
          cwd: tmp.dir,
          encoding: "utf8",
          timeout: 15_000,
          env: {
            PATH: process.env.PATH,
            HOME: tmp.dir,
            XDG_CONFIG_HOME: tmp.dir,
            XDG_CACHE_HOME: tmp.dir,
            XDG_STATE_HOME: tmp.dir,
            XDG_DATA_HOME: tmp.dir,
            NODE_COMPILE_CACHE: tmp.dir,
            TAILOR_CRASH_REPORTS_LOCAL: "off",
            TAILOR_CRASH_REPORTS_REMOTE: "off",
            NO_COLOR: "1",
            ...extraEnv,
          },
        },
      );

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
