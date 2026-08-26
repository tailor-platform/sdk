import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { describe, expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cliEntry = path.join(packageRoot, "bin/cli.mjs");
const CLI_TEST_TIMEOUT_MS = 15_000;

function runCli(args: string[]) {
  if (!existsSync(path.join(packageRoot, "dist/index.js"))) {
    throw new Error(
      "packages/sdk-plugin-seed is not built. Run `pnpm --filter @tailor-platform/sdk-plugin-seed build` first.",
    );
  }
  return spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

function parseErrorEnvelope(stderr: string): unknown {
  const envelope = stderr.trim().split(/\r?\n/).at(-1);
  expect(envelope).toBeDefined();
  return JSON.parse(envelope ?? "");
}

describe("seed CLI JSON errors", () => {
  test(
    "serializes a missing configuration error",
    () => {
      const configPath = fileURLToPath(new URL("__fixtures__/missing.config.ts", import.meta.url));
      expect(existsSync(configPath)).toBe(false);

      const result = runCli(["validate", "--json", "--config", configPath]);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(parseErrorEnvelope(result.stderr)).toEqual({
        error: {
          code: "UNEXPECTED_ERROR",
          message: `Configuration file not found: ${path.resolve(configPath)}`,
        },
      });
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "serializes a missing machine user error",
    () => {
      const configPath = fileURLToPath(
        new URL("__fixtures__/tailor.config.no-machine-user.ts", import.meta.url),
      );
      expect(existsSync(configPath)).toBe(true);

      const result = runCli(["apply", "--json", "--config", configPath]);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(parseErrorEnvelope(result.stderr)).toEqual({
        error: {
          code: "UNEXPECTED_ERROR",
          message:
            "Machine user name is required. Specify --machine-user <name> or configure machineUserName in seedPlugin options.",
        },
      });
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "includes a stack trace in verbose JSON errors",
    () => {
      const configPath = fileURLToPath(new URL("__fixtures__/missing.config.ts", import.meta.url));

      const result = runCli(["validate", "--json", "--verbose", "--config", configPath]);
      const envelope = parseErrorEnvelope(result.stderr) as {
        error: { code: string; message: string; stack?: string };
      };

      expect(result.status).toBe(1);
      expect(envelope.error.stack).toContain("Error: Configuration file not found:");
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "preserves human-readable errors without JSON mode",
    () => {
      const configPath = fileURLToPath(new URL("__fixtures__/missing.config.ts", import.meta.url));

      const result = runCli(["validate", "--config", configPath]);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe(
        `✖ Configuration file not found: ${path.resolve(configPath)}`,
      );
    },
    CLI_TEST_TIMEOUT_MS,
  );
});
