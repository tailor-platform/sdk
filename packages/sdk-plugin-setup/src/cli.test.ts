import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { describe, expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cliEntry = path.join(packageRoot, "bin/cli.mjs");
const CLI_TEST_TIMEOUT_MS = 15_000;
const conflictingEnvArgs = ["ci", "env", "--check", "--format", "terraform"];
const conflictingEnvMessage =
  "--check cannot be combined with --format terraform: it reads GitHub with gh and prints gh commands for what is missing.";

function runCli(args: string[], cwd = packageRoot) {
  if (!existsSync(path.join(packageRoot, "dist/cli.js"))) {
    throw new Error(
      "packages/sdk-plugin-setup is not built. Run `pnpm --filter @tailor-platform/sdk-plugin-setup build` first.",
    );
  }
  return spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH, FORCE_COLOR: "0" },
  });
}

function parseErrorEnvelope(stderr: string): unknown {
  const envelope = stderr.trim().split(/\r?\n/).at(-1);
  expect(envelope).toBeDefined();
  return JSON.parse(envelope ?? "");
}

function throwingConfigDir(thrown: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-throwing-config-"));
  writeFileSync(path.join(dir, "tailor.config.ts"), `throw ${thrown};\n`);
  return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("setup CLI JSON errors", () => {
  test(
    "keeps the error envelope on the last stderr line under --verbose",
    () => {
      const result = runCli([...conflictingEnvArgs, "--json", "--verbose"]);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("Stack trace:");
      expect(parseErrorEnvelope(result.stderr)).toEqual({
        error: {
          code: "UNEXPECTED_ERROR",
          message: conflictingEnvMessage,
          stack: expect.stringContaining(`Error: ${conflictingEnvMessage}`),
        },
      });
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "turns on JSON output from an --env-file",
    () => {
      const result = runCli([...conflictingEnvArgs, "-e", "src/__fixtures__/json-output.env"]);

      expect(result.status).toBe(1);
      expect(parseErrorEnvelope(result.stderr)).toEqual({
        error: { code: "UNEXPECTED_ERROR", message: conflictingEnvMessage },
      });
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "keeps the human stack trace under --verbose without --json",
    () => {
      const result = runCli([...conflictingEnvArgs, "--verbose"]);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`✖ ${conflictingEnvMessage}`);
      expect(result.stderr).toContain(`Stack trace:\nError: ${conflictingEnvMessage}`);
    },
    CLI_TEST_TIMEOUT_MS,
  );
});

describe("setup CLI errors thrown with a format()", () => {
  const generateTagWorkflow = ["ci", "tag", "--package-manager", "pnpm"];

  test(
    "puts the file before the message of a failure whose format() does not return a string",
    () => {
      using tmp = throwingConfigDir(
        'Object.assign(new Error("config is broken"), { format: () => ({ _errors: [] }) })',
      );

      const result = runCli(generateTagWorkflow, tmp.dir);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("✖ tailor.config.ts: config is broken");
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "prints a self-formatted failure's report unchanged",
    () => {
      using tmp = throwingConfigDir(
        'Object.assign(new Error("config is broken"), { format: () => "custom report" })',
      );

      const result = runCli(generateTagWorkflow, tmp.dir);

      expect(result.status).toBe(1);
      expect(result.stderr.trim().split(/\r?\n/).at(-1)).toBe("custom report");
    },
    CLI_TEST_TIMEOUT_MS,
  );
});
