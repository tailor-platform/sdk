import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const CLI_TEST_TIMEOUT_MS = 15_000;

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

const customerSchema = `
export const schema = {
  "~standard": {
    version: 1,
    vendor: "backfill-test",
    validate(value) {
      return {
        value: {
          ...value,
          id: value.id ?? crypto.randomUUID(),
          createdAt: value.createdAt ?? new Date().toISOString(),
        },
      };
    },
  },
};
`;

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("seed backfill-ids CLI", () => {
  test(
    "backfills ids into a positional data directory",
    () => {
      tempDir = mkdtempSync(path.join(tmpdir(), "seed-backfill-cli-"));
      writeFileSync(path.join(tempDir, "Customer.schema.ts"), customerSchema);
      writeFileSync(path.join(tempDir, "Customer.jsonl"), '{"name":"Acme","email":"a@acme.com"}\n');

      const result = runCli(["backfill-ids", "--json", tempDir]);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        backfilled: { Customer: 1 },
        path: tempDir,
      });

      const row = JSON.parse(readFileSync(path.join(tempDir, "Customer.jsonl"), "utf-8").trim());
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.createdAt).toBeUndefined();
    },
    CLI_TEST_TIMEOUT_MS,
  );
});
