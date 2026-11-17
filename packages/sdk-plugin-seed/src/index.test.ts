import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { describe, expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cliEntry = path.join(packageRoot, "bin/cli.mjs");
const CLI_TEST_TIMEOUT_MS = 15_000;

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  if (!existsSync(path.join(packageRoot, "dist/index.js"))) {
    throw new Error(
      "packages/sdk-plugin-seed is not built. Run `pnpm --filter @tailor-platform/sdk-plugin-seed build` first.",
    );
  }
  return spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    // Allowlisted so the runner's own GITHUB_ACTIONS, DEBUG, and RUNNER_DEBUG
    // cannot add annotation or stack-trace lines to the asserted output.
    env: { PATH: process.env.PATH, FORCE_COLOR: "0", ...extraEnv },
  });
}

function parseErrorEnvelope(stderr: string): unknown {
  const envelope = stderr.trim().split(/\r?\n/).at(-1);
  expect(envelope).toBeDefined();
  return JSON.parse(envelope ?? "");
}

function throwingConfig(thrown = 'new Error("config is broken")') {
  const dir = mkdtempSync(path.join(tmpdir(), "seed-throwing-config-"));
  const configPath = path.join(dir, "tailor.config.ts");
  writeFileSync(configPath, `throw ${thrown};\n`);
  return { configPath, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
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
          code: "CONFIG_NOT_FOUND",
          message: `Configuration file not found: ${path.resolve(configPath)}`,
          suggestion: "Check the path given with --config or TAILOR_CONFIG_PATH.",
          context: { file: path.resolve(configPath) },
        },
      });
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "reads the config path from an --env-file",
    () => {
      const result = runCli(["validate", "--json", "-ve", "src/__fixtures__/missing-config.env"]);

      expect(result.status).toBe(1);
      expect(parseErrorEnvelope(result.stderr)).toMatchObject({
        error: {
          code: "CONFIG_NOT_FOUND",
          message: "Configuration file not found: src/__fixtures__/missing.config.ts",
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
      using tmp = throwingConfig();

      const result = runCli(["validate", "--json", "--verbose", "--config", tmp.configPath]);
      const envelope = parseErrorEnvelope(result.stderr) as {
        error: { code: string; message: string; stack?: string };
      };

      expect(result.status).toBe(1);
      expect(envelope.error.stack).toContain("Error: config is broken");
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "preserves human-readable errors without JSON mode",
    () => {
      using tmp = throwingConfig();

      const result = runCli(["validate", "--config", tmp.configPath]);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe(
        `✖ ${path.relative(packageRoot, tmp.configPath)}: config is broken`,
      );
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test.each([
    { name: "a command", args: ["validate", "--bogus"] },
    { name: "the plugin without a subcommand", args: ["--bogus"] },
  ])(
    "exits with 2 for an unknown option given to $name",
    ({ args }) => {
      const result = runCli(args);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe("✖ Unknown flags: bogus");
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "annotates the failure once under GitHub Actions",
    () => {
      using tmp = throwingConfig();
      const located = `${path.relative(packageRoot, tmp.configPath)}: config is broken`;

      const result = runCli(["validate", "--config", tmp.configPath], { GITHUB_ACTIONS: "true" });

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.match(/^::error/gm)).toHaveLength(1);
      expect(result.stderr.trim().split(/\r?\n/)).toEqual([
        `✖ ${located}`,
        `::error title=Error::${located}`,
      ]);
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "puts the file a failure points at before its message",
    () => {
      using tmp = throwingConfig();

      const result = runCli(["validate", "--config", tmp.configPath]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `${path.relative(packageRoot, tmp.configPath)}: config is broken`,
      );
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "puts the file before the message of a failure whose format() does not return a string",
    () => {
      using tmp = throwingConfig(
        'Object.assign(new Error("config is broken"), { format: () => ({ _errors: [] }) })',
      );

      const result = runCli(["validate", "--config", tmp.configPath]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `✖ ${path.relative(packageRoot, tmp.configPath)}: config is broken`,
      );
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "prints a self-formatted failure's report unchanged",
    () => {
      using tmp = throwingConfig(
        'Object.assign(new Error("config is broken"), { format: () => "custom report" })',
      );

      const result = runCli(["validate", "--config", tmp.configPath]);

      expect(result.status).toBe(1);
      expect(result.stderr.trim().split(/\r?\n/).at(-1)).toBe("custom report");
    },
    CLI_TEST_TIMEOUT_MS,
  );
});
