import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

function throwingConfig() {
  const dir = mkdtempSync(path.join(tmpdir(), "erd-throwing-config-"));
  const configPath = path.join(dir, "tailor.config.ts");
  writeFileSync(configPath, 'throw new Error("config is broken");\n');
  return { configPath, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
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
    "reads the config path from an --env-file",
    () => {
      const result = runCli(["export", "--json", "-e", "src/__fixtures__/missing-config.env"]);

      expect(result.status).toBe(1);
      expect(parseErrorEnvelope(result.stderr)).toEqual({
        error: {
          code: "UNEXPECTED_ERROR",
          message: "Configuration file not found: src/__fixtures__/missing.config.ts",
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

  test(
    "puts the file a failure points at before its message",
    () => {
      using tmp = throwingConfig();

      const result = runCli(["export", "--config", tmp.configPath]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `${path.relative(packageRoot, tmp.configPath)}: config is broken`,
      );
    },
    CLI_TEST_TIMEOUT_MS,
  );
});
