import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/index";
import { generateSchemaDDL } from "#/utils/tailordb-ddl";
import { toSchemaOutputs } from "#/utils/test/internal";
import { createKyselyPGlite } from "#/vitest/pglite-kysely";
import { generatePGliteSchemaModule, toDDLTables } from "./pglite-schema";
import { kyselyTypePlugin } from "./index";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { TailorDBReadyContext } from "#/plugin/types";

const everyType = db.table("EveryType", {
  uuidField: db.uuid(),
  stringField: db.string(),
  boolField: db.bool(),
  intField: db.int(),
  floatField: db.float(),
  decimalField: db.decimal({ scale: 2 }),
  dateField: db.date(),
  datetimeField: db.datetime(),
  timeField: db.time(),
  enumField: db.enum(["A", "B"]),
  nestedField: db.object({ name: db.string(), at: db.datetime({ optional: true }) }),
  nestedList: db.object({ n: db.int() }, { array: true }),
  tags: db.string({ array: true }),
  optionalInt: db.int({ optional: true }),
  withDefault: db.string().default("pending"),
  ...db.fields.timestamps(),
});

const invoice = db
  .table("Invoice", {
    invoiceNumber: db.string().serial({ start: 1000, format: "INV-%05d" }),
    sequentialId: db.int().serial({ start: 1, maxValue: 999999 }),
    email: db.string().unique(),
    region: db.string(),
  })
  .indexes({ fields: ["region", "email"], unique: true }, { fields: ["region", "invoiceNumber"] });

function parsed(
  tables: Record<string, unknown>,
  namespace = "tailordb",
): Record<string, TailorDBType> {
  return parseTypes(toSchemaOutputs(tables), namespace, {});
}

function ctx(
  namespaces: { namespace: string; tables: Record<string, TailorDBType> }[],
  pluginConfig: { distPath: string; pgliteSchemaPath?: string },
): TailorDBReadyContext<typeof pluginConfig> {
  return {
    tailordb: namespaces.map((ns) => ({
      namespace: ns.namespace,
      tables: ns.tables,
      sourceInfo: new Map(),
      pluginAttachments: new Map(),
    })),
    auth: undefined,
    baseDir: "/test",
    configPath: "tailor.config.ts",
    pluginConfig,
  };
}

describe("toDDLTables", () => {
  test("carries the parsed field configs and unique indexes through", () => {
    const [table] = toDDLTables(parsed({ Invoice: invoice }));
    expect(table!.name).toBe("Invoice");
    expect(table!.fields.id).toMatchObject({ type: "uuid" });
    expect(table!.fields.email).toMatchObject({ type: "string", required: true, unique: true });
    expect(table!.fields.invoiceNumber!.serial).toEqual({
      start: 1000,
      maxValue: undefined,
      format: "INV-%05d",
    });
    expect(table!.indexes).toEqual({
      idx_region_email: { fields: ["region", "email"], unique: true },
      idx_region_invoiceNumber: { fields: ["region", "invoiceNumber"], unique: undefined },
    });
  });
});

describe("generatePGliteSchemaModule", () => {
  test("exports one script per namespace and escapes template literal syntax", () => {
    const content = generatePGliteSchemaModule([
      { namespace: "tailordb", tables: parsed({ Invoice: invoice, EveryType: everyType }) },
      {
        namespace: "other",
        tables: parsed({ "Tick`${x}": db.table("Tick`${x}", { v: db.string() }) }, "other"),
      },
    ]);

    expect(content).toContain("DO NOT EDIT");
    expect(content).toContain("export const pgliteSchema = {");
    expect(content).toContain(
      '  "tailordb": `CREATE SEQUENCE IF NOT EXISTS "Invoice_invoiceNumber_seq" START WITH 1000;',
    );
    expect(content).toContain('CREATE TABLE IF NOT EXISTS "Invoice" (');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS "EveryType" (');
    expect(content).toContain('"createdAt" timestamptz NOT NULL DEFAULT now()');
    expect(content).toContain('"email" text NOT NULL UNIQUE');
    expect(content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_idx_region_email" ON "Invoice" ("region", "email");',
    );
    expect(content).not.toContain("Invoice_idx_region_invoiceNumber");
    expect(content).toContain('  "other": `CREATE TABLE IF NOT EXISTS "Tick\\`\\${x}" (');
    expect(content).toMatch(/\n} as const;\n$/);
  });
});

describe("kyselyTypePlugin pgliteSchemaPath", () => {
  const namespaces = [{ namespace: "tailordb", tables: parsed({ Invoice: invoice }) }];

  test("emits the schema module next to the types when configured", async () => {
    const config = { distPath: "/out/tailordb.ts", pgliteSchemaPath: "/out/tailordb.pglite.ts" };
    const result = await kyselyTypePlugin(config).onTailorDBReady!(ctx(namespaces, config));
    expect(result.files.map((f) => f.path)).toEqual([config.distPath, config.pgliteSchemaPath]);
    expect(result.files[1]!.content).toContain("export const pgliteSchema = {");
  });

  test("emits only the types when not configured", async () => {
    const config = { distPath: "/out/tailordb.ts" };
    const result = await kyselyTypePlugin(config).onTailorDBReady!(ctx(namespaces, config));
    expect(result.files.map((f) => f.path)).toEqual([config.distPath]);
  });

  test("emits nothing for a project without tables", async () => {
    const config = { distPath: "/out/tailordb.ts", pgliteSchemaPath: "/out/tailordb.pglite.ts" };
    const result = await kyselyTypePlugin(config).onTailorDBReady!(
      ctx([{ namespace: "tailordb", tables: {} }], config),
    );
    expect(result.files).toEqual([]);
  });
});

describe("generated DDL on PGlite", () => {
  const pglite = new PGlite();
  // oxlint-disable-next-line typescript/no-explicit-any -- rows are asserted by shape below
  const kysely = createKyselyPGlite<any>(pglite);
  const ddl = generateSchemaDDL(toDDLTables(parsed({ EveryType: everyType, Invoice: invoice })));

  // Loading the Postgres WASM binary takes seconds when the whole suite runs.
  beforeAll(() => pglite.waitReady, 60_000);
  afterAll(() => kysely.destroy());

  test("applies, and applies again without error", async () => {
    await pglite.exec(ddl);
    await pglite.exec(ddl);
    const tables = await pglite.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(["EveryType", "Invoice"]);
  });

  test("round-trips every field type through getDB-shaped inserts", async () => {
    const at = new Date("2024-01-02T03:04:05.000Z");
    await kysely
      .insertInto("EveryType")
      .values({
        uuidField: "0f5b7d4e-0000-4000-8000-000000000000",
        stringField: "s",
        boolField: true,
        intField: 3,
        floatField: 1.5,
        decimalField: "12.50",
        dateField: "2024-01-02",
        datetimeField: at,
        timeField: "12:34",
        enumField: "A",
        nestedField: JSON.stringify({ name: "n" }),
        nestedList: JSON.stringify([{ n: 1 }, { n: 2 }]),
        tags: ["a", "b"],
      })
      .execute();

    const row = await kysely.selectFrom("EveryType").selectAll().executeTakeFirstOrThrow();
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.uuidField).toBe("0f5b7d4e-0000-4000-8000-000000000000");
    expect(row.boolField).toBe(true);
    expect(row.intField).toBe(3);
    expect(row.floatField).toBe(1.5);
    expect(row.decimalField).toBe("12.50");
    expect(row.dateField).toEqual(new Date("2024-01-02T00:00:00.000Z"));
    expect(row.datetimeField).toEqual(at);
    expect(row.timeField).toBe("12:34:00");
    expect(row.enumField).toBe("A");
    expect(row.nestedField).toEqual({ name: "n" });
    expect(row.nestedList).toEqual([{ n: 1 }, { n: 2 }]);
    expect(row.tags).toEqual(["a", "b"]);
    expect(row.optionalInt).toBeNull();
    expect(row.withDefault).toBe("pending");
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  test("serial fields are assigned by the database and unique constraints hold", async () => {
    await kysely
      .insertInto("Invoice")
      .values([
        { email: "a@example.com", region: "jp" },
        { email: "b@example.com", region: "jp" },
      ])
      .execute();
    const rows = await kysely
      .selectFrom("Invoice")
      .select(["invoiceNumber", "sequentialId"])
      .orderBy("sequentialId")
      .execute();
    expect(rows).toEqual([
      { invoiceNumber: "INV-01000", sequentialId: 1 },
      { invoiceNumber: "INV-01001", sequentialId: 2 },
    ]);

    await expect(
      kysely.insertInto("Invoice").values({ email: "a@example.com", region: "us" }).execute(),
    ).rejects.toThrow(/unique/i);
    await expect(
      kysely.insertInto("Invoice").values({ email: "c@example.com", region: "jp" }).execute(),
    ).resolves.toBeDefined();
  });
});
