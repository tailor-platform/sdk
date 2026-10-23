import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { describe, expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cliEntry = path.join(packageRoot, "bin/cli.mjs");
const CLI_TEST_TIMEOUT_MS = 15_000;
const missingConfigPath = fileURLToPath(new URL("__fixtures__/missing.config.ts", import.meta.url));

function runCli(args: string[]) {
  if (!existsSync(path.join(packageRoot, "dist/cli.js"))) {
    throw new Error(
      "packages/sdk-plugin-tailordb-erd is not built. Run `pnpm --filter @tailor-platform/sdk-plugin-tailordb-erd build` first.",
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

describe("tailordb-erd CLI JSON errors", () => {
  test(
    "serializes a missing configuration error",
    () => {
      expect(existsSync(missingConfigPath)).toBe(false);

      const result = runCli(["export", "--json", "--config", missingConfigPath]);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(parseErrorEnvelope(result.stderr)).toEqual({
        error: {
          code: "UNEXPECTED_ERROR",
          message: `Configuration file not found: ${path.resolve(missingConfigPath)}`,
        },
      });
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "includes a stack trace in verbose JSON errors",
    () => {
      const result = runCli(["export", "--json", "--verbose", "--config", missingConfigPath]);
      const envelope = parseErrorEnvelope(result.stderr) as {
        error: { code: string; message: string; stack?: string };
      };

      expect(result.status).toBe(1);
      expect(envelope.error.stack).toContain("Error: Configuration file not found:");
    },
    CLI_TEST_TIMEOUT_MS,
  );
});
