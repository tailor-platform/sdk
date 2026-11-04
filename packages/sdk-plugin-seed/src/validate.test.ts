import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createCommonArgs, runCommand } from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { seedValidateCommand } from "./validate";

const sdk = vi.hoisted(() => ({ loadSeedContext: vi.fn() }));

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  newline: vi.fn(),
  out: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@tailor-platform/sdk/cli", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tailor-platform/sdk/cli")>()),
  ...sdk,
  logger,
}));

// The data dir lives outside the workspace, so its schema files import the
// SDK by resolved URL instead of by package name.
const seedUrl = import.meta.resolve("@tailor-platform/sdk/seed");

function schemaSource(foreignKeys: object[] = []): string {
  return `
import { defineSchema } from "${seedUrl}";

export const schema = defineSchema(
  {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) =>
        typeof value.name === "string"
          ? { value }
          : { issues: [{ message: "name is required", path: [{ key: "name" }] }] },
    },
  },
  { foreignKeys: ${JSON.stringify(foreignKeys)} },
);
`;
}

function writeLines(file: string, rows: object[]): string {
  writeFileSync(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
  return file;
}

let distPath: string;
let dataDir: string;
let cogs: string;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
  distPath = mkdtempSync(path.join(tmpdir(), "seed-validate-command-"));
  dataDir = path.join(distPath, "data");
  cogs = path.join(dataDir, "cogs");
  mkdirSync(cogs, { recursive: true });
  writeFileSync(path.join(dataDir, "Item.schema.ts"), schemaSource());
  writeFileSync(
    path.join(dataDir, "ItemValuation.schema.ts"),
    schemaSource([{ column: "itemId", references: { table: "Item", column: "id" } }]),
  );
  writeLines(path.join(dataDir, "Item.jsonl"), [{ id: "i1", name: "base item" }]);
  writeLines(path.join(dataDir, "ItemValuation.jsonl"), []);
  sdk.loadSeedContext.mockResolvedValue({
    config: { path: path.join(distPath, "tailor.config.ts") },
    distPath,
    datasets: {},
    idpUser: null,
    namespaces: [
      {
        namespace: "tailordb",
        types: ["Item", "ItemValuation"],
        dependencies: { Item: [], ItemValuation: ["Item"] },
        selfRefTypes: [],
        requiredFields: { Item: [], ItemValuation: [] },
      },
    ],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(distPath, { recursive: true, force: true });
});

function runValidate(args: string[]) {
  return runCommand(seedValidateCommand, args, {
    // Parse global arguments like the plugin entrypoint.
    globalArgs: z.strictObject(createCommonArgs({ verboseAlias: "v" })),
  });
}

describe("seedValidateCommand", () => {
  test.each([undefined, null])("requires an id with --upsert: %s", async (id) => {
    writeLines(path.join(dataDir, "Item.jsonl"), [{ id, name: "item" }]);
    expect((await runValidate([])).exitCode).toBe(0);

    const result = await runValidate(["--upsert"]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("`id` is required with --upsert");
    expect(logger.out).not.toHaveBeenCalledWith(expect.objectContaining({ valid: true }));
  });

  test("checks the same required fields as apply --upsert", async () => {
    const context = await sdk.loadSeedContext();
    context.namespaces[0].requiredFields.Item = ["name"];
    writeLines(path.join(dataDir, "Item.jsonl"), [{ id: "i1", name: null }]);
    expect((await runValidate([])).exitCode).toBe(1);

    const result = await runValidate(["--upsert"]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("field `name` is required with --upsert");
  });

  test.each(["--dataset", "--all-datasets"])(
    "checks dataset rows with --upsert and honors --no-base: %s",
    async (mode) => {
      const selection = mode === "--dataset" ? [mode, "cogs"] : [mode];
      writeLines(path.join(dataDir, "Item.jsonl"), [{ name: "base without id" }]);
      writeLines(path.join(cogs, "Item.jsonl"), [{ id: "i2", name: "dataset item" }]);
      expect((await runValidate(["--upsert", ...selection])).exitCode).toBe(1);
      expect((await runValidate(["--upsert", ...selection, "--no-base"])).exitCode).toBe(0);
      writeLines(path.join(cogs, "Item.jsonl"), [{ name: "dataset without id" }]);
      const result = await runValidate(["--upsert", ...selection, "--no-base"]);
      expect(result.exitCode).toBe(1);
      expect(String(result.error)).toContain(path.join(cogs, "Item.jsonl"));
    },
  );

  test("accepts complete rows and IdP users without an id with --upsert", async () => {
    const context = await sdk.loadSeedContext();
    context.namespaces[0].requiredFields.Item = ["name"];
    writeFileSync(path.join(dataDir, "_User.schema.ts"), schemaSource());
    writeLines(path.join(dataDir, "_User.jsonl"), [{ name: "user" }]);
    const result = await runValidate(["--upsert", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(logger.out).toHaveBeenCalledWith({ valid: true, path: dataDir });
  });

  test("rejects --upsert together with a path", async () => {
    const result = await runValidate(["--upsert", dataDir]);
    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("--upsert cannot be combined with a path");
  });

  test("validates all datasets together with base data", async () => {
    const local = path.join(dataDir, "local");
    mkdirSync(local);
    writeLines(path.join(local, "Item.jsonl"), [{ id: "i2", name: "local item" }]);
    writeLines(path.join(cogs, "ItemValuation.jsonl"), [{ id: "v1", name: "v", itemId: "i2" }]);
    const result = await runValidate(["--all-datasets", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(logger.out).toHaveBeenCalledWith({
      valid: true,
      path: dataDir,
      datasets: ["cogs", "local"],
    });
    writeLines(path.join(local, "Item.jsonl"), [{ id: "i1", name: "duplicate base item" }]);
    const duplicate = await runValidate(["--all-datasets"]);
    expect(duplicate.exitCode).toBe(1);
    expect(String(duplicate.error)).toContain(path.join(local, "Item.jsonl"));
  });

  test("validates all datasets without base rows", async () => {
    writeLines(path.join(cogs, "Item.jsonl"), [{ id: "i1", name: "dataset item" }]);
    writeLines(path.join(cogs, "ItemValuation.jsonl"), [{ id: "v1", name: "v", itemId: "i1" }]);
    const result = await runValidate(["--all-datasets", "--no-base"]);
    expect(result.exitCode).toBe(0);
    const withBase = await runValidate(["--all-datasets"]);
    expect(withBase.exitCode).toBe(1);
    expect(String(withBase.error)).toContain(path.join(cogs, "Item.jsonl"));
  });

  test.each(["dataset", "path"])("rejects all datasets combined with %s", async (kind) => {
    const extra = kind === "path" ? [dataDir] : ["--dataset", "cogs"];
    const result = await runValidate(["--all-datasets", ...extra]);
    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("cannot be combined");
  });

  test("validates a dataset on top of the base data", async () => {
    writeLines(path.join(cogs, "ItemValuation.jsonl"), [{ id: "v1", name: "v", itemId: "i1" }]);

    const result = await runValidate(["--dataset", "cogs", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(logger.out).toHaveBeenCalledWith({ valid: true, path: dataDir, datasets: ["cogs"] });
  });

  test("reports an id defined in both the base data and a dataset", async () => {
    writeLines(path.join(cogs, "Item.jsonl"), [{ id: "i1", name: "duplicate" }]);

    const result = await runValidate(["--dataset", "cogs"]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain(path.join(cogs, "Item.jsonl"));
  });

  test("leaves the base data out with --no-base", async () => {
    writeLines(path.join(cogs, "Item.jsonl"), [{ id: "i2", name: "cogs item" }]);
    writeLines(path.join(cogs, "ItemValuation.jsonl"), [{ id: "v1", name: "v", itemId: "i1" }]);

    const result = await runValidate(["--dataset", "cogs", "--no-base"]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain(path.join(cogs, "ItemValuation.jsonl"));
  });

  test("rejects a dataset together with a path", async () => {
    const result = await runValidate(["--dataset", "cogs", dataDir]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain(
      "--dataset, --all-datasets and --no-base cannot be combined with a path",
    );
  });

  test("rejects --no-base without a dataset", async () => {
    const result = await runValidate(["--no-base"]);

    expect(result.exitCode).toBe(1);
    expect(String(result.error)).toContain("--no-base needs at least one --dataset");
  });
});
