import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import { fillSeedData } from "@tailor-platform/sdk/seed";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";

const uuid = z.uuid();

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

const type = db
  .table("${typeName}", "${typeName}", {
    name: db.string(),
    serialNumber: db.int().serial({ start: 1 }),
    profile: db.object({ nickname: db.string({ optional: true }) }, { optional: true }),
    ...db.fields.timestamps(),
  })
  .validate(({ newRecord }, issues) => {
    if (!newRecord.name) {
      issues("name", "Name is required");
    }
  });

const schemaType = t.object({
  ...type.pickFields(["id", "createdAt", "updatedAt"], { optional: true }),
  ...type.omitFields(["id", "createdAt", "updatedAt", "serialNumber"]),
});

export const hook = createTailorDBHook(type, { validate: false });
export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(type)),
);
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

    expect(result.filled).toEqual([{ table: "Widget", file: jsonlPath, fields: ["id"], count: 2 }]);

    const rows = await readRows(jsonlPath);
    expect(rows.map((row) => row.name)).toEqual(["second", "first"]);
    expect(rows[1]?.note).toBe("kept");
    // Keys follow the type's field order, with undeclared ones after them.
    expect(Object.keys(rows[0] ?? {})).toEqual(["id", "name"]);
    expect(Object.keys(rows[1] ?? {})).toEqual(["id", "name", "note"]);
    for (const row of rows) {
      expect(uuid.safeParse(row.id).success, `id: ${String(row.id)}`).toBe(true);
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

    expect(result.filled).toEqual([
      { table: "Widget", file: jsonlPath, fields: ["id", "createdAt"], count: 2 },
    ]);

    const rows = await readRows(jsonlPath);
    expect(rows[0]?.createdAt).toBe("2020-01-02T03:04:05.000Z");
    expect(rows[1]?.createdAt).toEqual(expect.any(String));
    for (const row of rows) {
      expect(Object.keys(row)).toEqual(["id", "name", "createdAt"]);
      expect(uuid.safeParse(row.id).success, `id: ${String(row.id)}`).toBe(true);
      expect(row).not.toHaveProperty("updatedAt");
    }
  });

  test("leaves a file that is missing none of the fields untouched", async () => {
    const jsonlPath = await writeTable("Widget", [
      '{"id":"11111111-1111-1111-1111-111111111111","name":"first"}',
    ]);
    const before = await readFile(jsonlPath, "utf-8");

    const result = await fillSeedData({ path: dataDir });

    expect(result.filled).toEqual([]);
    expect(result.output).toContain("Nothing to fill");
    await expect(readFile(jsonlPath, "utf-8")).resolves.toBe(before);
  });

  test("warns about a field no seeded type produces", async () => {
    const jsonlPath = await writeTable("Widget", ['{"name":"first"}']);
    const before = await readFile(jsonlPath, "utf-8");

    const result = await fillSeedData({ path: dataDir, fields: ["nope"] });

    expect(result.filled).toEqual([]);
    expect(result.output).toContain("No seed data produces a value for: nope");
    await expect(readFile(jsonlPath, "utf-8")).resolves.toBe(before);
  });

  test("fills a row while the data around it is still invalid", async () => {
    // `name` is required and wrongly typed here: filling must not depend on the
    // data being ready, since the ids are what you need to make it ready.
    const jsonlPath = await writeTable("Widget", ['{"name":42}', '{"unrelated":"row"}']);

    const result = await fillSeedData({ path: dataDir });

    expect(result.filled).toEqual([{ table: "Widget", file: jsonlPath, fields: ["id"], count: 2 }]);
    const rows = await readRows(jsonlPath);
    expect(rows[0]?.name).toBe(42);
    expect(rows[1]?.unrelated).toBe("row");
    for (const row of rows) {
      expect(uuid.safeParse(row.id).success, `id: ${String(row.id)}`).toBe(true);
    }
  });

  test("leaves a line that gains nothing byte for byte", async () => {
    const jsonlPath = await writeTable("Widget", [
      '{ "id":"11111111-1111-1111-1111-111111111111",  "name":"spaced" }',
      '{"name":"gains an id"}',
    ]);

    const result = await fillSeedData({ path: dataDir });

    expect(result.filled).toEqual([{ table: "Widget", file: jsonlPath, fields: ["id"], count: 1 }]);
    const lines = (await readFile(jsonlPath, "utf-8")).split("\n");
    // Untouched: the odd spacing survives because the line was never re-serialized.
    expect(lines[0]).toBe('{ "id":"11111111-1111-1111-1111-111111111111",  "name":"spaced" }');
    expect(JSON.parse(lines[1] ?? "{}")).toEqual({ id: expect.any(String), name: "gains an id" });
  });

  test("keeps an undeclared key named after an Object member", async () => {
    const jsonlPath = await writeTable("Widget", [
      '{"name":"first","toString":"kept","__proto__":"kept"}',
    ]);

    const result = await fillSeedData({ path: dataDir });

    expect(result.filled).toEqual([{ table: "Widget", file: jsonlPath, fields: ["id"], count: 1 }]);
    const rows = await readRows(jsonlPath);
    expect(Object.keys(rows[0] ?? {})).toEqual(["id", "name", "toString", "__proto__"]);
  });

  test("does not fill a field the platform assigns, such as a serial", async () => {
    const jsonlPath = await writeTable("Widget", ['{"name":"first"}']);
    const before = await readFile(jsonlPath, "utf-8");

    const result = await fillSeedData({ path: dataDir, fields: ["serialNumber"] });

    expect(result.filled).toEqual([]);
    expect(result.output).toContain("No seed data produces a value for: serialNumber");
    await expect(readFile(jsonlPath, "utf-8")).resolves.toBe(before);
  });

  test("writes nothing when a schema file predates the current generator", async () => {
    const widgetPath = await writeTable("Widget", ['{"name":"widget"}']);
    const stalePath = await writeTable("Gadget", ['{"name":"gadget"}']);
    // A schema file generated before the hook was exported.
    await writeFile(
      path.join(dataDir, "Gadget.schema.ts"),
      (await readFile(path.join(dataDir, "Gadget.schema.ts"), "utf-8")).replace(
        "export const hook =",
        "const hook =",
      ),
    );
    const widgetBefore = await readFile(widgetPath, "utf-8");

    await expect(fillSeedData({ path: dataDir })).rejects.toThrow(
      /Gadget\.schema\.ts does not export `hook`\. Run `tailor generate`/,
    );
    // Widget sorts before Gadget in neither direction that matters: whichever is
    // reached first, nothing is written once any schema file is stale.
    await expect(readFile(widgetPath, "utf-8")).resolves.toBe(widgetBefore);
    expect((await readRows(stalePath))[0]).not.toHaveProperty("id");
  });

  test("fills a row the type's own validate would reject", async () => {
    // The type requires `name`; this row has none, which is exactly the state
    // the fill exists to get ids into.
    const jsonlPath = await writeTable("Widget", ['{"note":"no name yet"}']);

    const result = await fillSeedData({ path: dataDir });

    expect(result.filled).toEqual([{ table: "Widget", file: jsonlPath, fields: ["id"], count: 1 }]);
    expect(uuid.safeParse((await readRows(jsonlPath))[0]?.id).success).toBe(true);
  });

  test("does not write an empty object for a nested field the row never had", async () => {
    const jsonlPath = await writeTable("Widget", ['{"name":"first"}']);

    const result = await fillSeedData({ path: dataDir, fields: ["id", "profile"] });

    expect(result.filled).toEqual([{ table: "Widget", file: jsonlPath, fields: ["id"], count: 1 }]);
    expect(result.output).toContain("No seed data produces a value for: profile");
    expect(await readRows(jsonlPath)).toEqual([{ id: expect.any(String), name: "first" }]);
  });

  test("fills only the named file when given a .jsonl path", async () => {
    const widgetPath = await writeTable("Widget", ['{"name":"widget"}']);
    const gadgetPath = await writeTable("Gadget", ['{"name":"gadget"}']);

    const result = await fillSeedData({ path: widgetPath });

    expect(result.filled.map(({ table }) => table)).toEqual(["Widget"]);
    const widgetId = (await readRows(widgetPath))[0]?.id;
    expect(uuid.safeParse(widgetId).success, `id: ${String(widgetId)}`).toBe(true);
    expect((await readRows(gadgetPath))[0]).not.toHaveProperty("id");
  });
});
