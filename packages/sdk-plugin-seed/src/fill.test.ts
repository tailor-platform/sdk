import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import { fillSeedData } from "@tailor-platform/sdk/seed";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The generated data dir lives outside the workspace, so the schema files it
// holds import the SDK by resolved URL instead of by package name.
const sdkUrls = {
  root: import.meta.resolve("@tailor-platform/sdk"),
  seed: import.meta.resolve("@tailor-platform/sdk/seed"),
  test: import.meta.resolve("@tailor-platform/sdk/test"),
};

/**
 * The shape `seedPlugin` generates for a TailorDB type: `id` and the
 * hook-computed timestamps are optional in the schema, and the hook fills them
 * in before validation.
 */
function schemaSource(typeName: string): string {
  return `
import { db, t } from "${sdkUrls.root}";
import { defineSchema } from "${sdkUrls.seed}";
import { createStandardSchema, createTailorDBHook } from "${sdkUrls.test}";

const type = db.table("${typeName}", "${typeName}", {
  name: db.string(),
  ...db.fields.timestamps(),
});

const schemaType = t.object({
  ...type.pickFields(["id", "createdAt", "updatedAt"], { optional: true }),
  ...type.omitFields(["id", "createdAt", "updatedAt"]),
});

export const schema = defineSchema(createStandardSchema(schemaType, createTailorDBHook(type)));
`;
}

let dataDir: string;

async function writeTable(typeName: string, rows: string[]): Promise<string> {
  const jsonlPath = path.join(dataDir, `${typeName}.jsonl`);
  await writeFile(path.join(dataDir, `${typeName}.schema.ts`), schemaSource(typeName));
  await writeFile(jsonlPath, rows.length > 0 ? `${rows.join("\n")}\n` : "");
  return jsonlPath;
}

async function readRows(jsonlPath: string): Promise<Record<string, unknown>[]> {
  const content = await readFile(jsonlPath, "utf-8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("fillSeedData", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "fill-seed-data-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("defaults to id, writing it into every row that lacks one", async () => {
    const jsonlPath = await writeTable("Widget", [
      '{"name":"second"}',
      '{"name":"first","note":"kept"}',
    ]);

    const result = await fillSeedData({ path: dataDir });

    expect(result.valid).toBe(true);
    expect(result.valid && result.filled).toEqual([
      { table: "Widget", file: jsonlPath, fields: ["id"], count: 2 },
    ]);

    const rows = await readRows(jsonlPath);
    expect(rows.map((row) => row.name)).toEqual(["second", "first"]);
    expect(rows[1]?.note).toBe("kept");
    // Keys follow the type's field order, with undeclared ones after them.
    expect(Object.keys(rows[0] ?? {})).toEqual(["id", "name"]);
    expect(Object.keys(rows[1] ?? {})).toEqual(["id", "name", "note"]);
    for (const row of rows) {
      expect(row.id).toMatch(UUID_PATTERN);
      // The hook computes these before validation; only the named fields are written back.
      expect(row).not.toHaveProperty("createdAt");
      expect(row).not.toHaveProperty("updatedAt");
    }
  });

  test("fills the named fields, leaving a value the row already has alone", async () => {
    const jsonlPath = await writeTable("Widget", [
      '{"name":"dated","createdAt":"2020-01-02T03:04:05.000Z"}',
      '{"name":"undated"}',
    ]);

    const result = await fillSeedData({ path: dataDir, fields: ["id", "createdAt"] });

    expect(result.valid && result.filled).toEqual([
      { table: "Widget", file: jsonlPath, fields: ["id", "createdAt"], count: 2 },
    ]);

    const rows = await readRows(jsonlPath);
    expect(rows[0]?.createdAt).toBe("2020-01-02T03:04:05.000Z");
    expect(rows[1]?.createdAt).toEqual(expect.any(String));
    for (const row of rows) {
      expect(Object.keys(row)).toEqual(["id", "name", "createdAt"]);
      expect(row.id).toMatch(UUID_PATTERN);
      expect(row).not.toHaveProperty("updatedAt");
    }
  });

  test("leaves a file that is missing none of the fields untouched", async () => {
    const jsonlPath = await writeTable("Widget", [
      '{"id":"11111111-1111-1111-1111-111111111111","name":"first"}',
    ]);
    const before = await readFile(jsonlPath, "utf-8");

    const result = await fillSeedData({ path: dataDir });

    expect(result.valid).toBe(true);
    expect(result.valid && result.filled).toEqual([]);
    expect(result.output).toContain("Nothing to fill");
    await expect(readFile(jsonlPath, "utf-8")).resolves.toBe(before);
  });

  test("warns about a field no seeded type produces", async () => {
    const jsonlPath = await writeTable("Widget", ['{"name":"first"}']);
    const before = await readFile(jsonlPath, "utf-8");

    const result = await fillSeedData({ path: dataDir, fields: ["nope"] });

    expect(result.valid && result.filled).toEqual([]);
    expect(result.output).toContain("No seed data produces a value for: nope");
    await expect(readFile(jsonlPath, "utf-8")).resolves.toBe(before);
  });

  test("reports invalid data and writes nothing", async () => {
    const jsonlPath = await writeTable("Widget", ['{"name":42}']);
    const before = await readFile(jsonlPath, "utf-8");

    const result = await fillSeedData({ path: dataDir });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.error).toContain("Widget.jsonl");
    await expect(readFile(jsonlPath, "utf-8")).resolves.toBe(before);
  });

  test("fills only the named file when given a .jsonl path", async () => {
    const widgetPath = await writeTable("Widget", ['{"name":"widget"}']);
    const gadgetPath = await writeTable("Gadget", ['{"name":"gadget"}']);

    const result = await fillSeedData({ path: widgetPath });

    expect(result.valid && result.filled.map(({ table }) => table)).toEqual(["Widget"]);
    expect((await readRows(widgetPath))[0]?.id).toMatch(UUID_PATTERN);
    expect((await readRows(gadgetPath))[0]).not.toHaveProperty("id");
  });
});
