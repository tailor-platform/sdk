import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { describe, expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cliEntry = path.join(packageRoot, "bin/cli.mjs");
const CLI_TEST_TIMEOUT_MS = 15_000;
const conflictingEnvArgs = ["ci", "env", "--check", "--format", "terraform"];
const conflictingEnvMessage =
  "--check cannot be combined with --format terraform: it reads GitHub with gh and prints gh commands for what is missing.";

function runCli(args: string[]) {
  if (!existsSync(path.join(packageRoot, "dist/cli.js"))) {
    throw new Error(
      "packages/sdk-plugin-setup is not built. Run `pnpm --filter @tailor-platform/sdk-plugin-setup build` first.",
    );
  }
  return spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH, FORCE_COLOR: "0" },
  });
}

function parseErrorEnvelope(stderr: string): unknown {
  const envelope = stderr.trim().split(/\r?\n/).at(-1);
  expect(envelope).toBeDefined();
  return JSON.parse(envelope ?? "");
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
