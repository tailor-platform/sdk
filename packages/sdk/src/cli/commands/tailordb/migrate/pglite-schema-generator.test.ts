import * as fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import * as path from "pathe";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { generateSchemaDDL } from "#/utils/tailordb-ddl";
import { createKyselyPGlite } from "#/vitest/pglite-kysely";
import { writeDbTypesFile } from "./db-types-generator";
import { SCHEMA_SNAPSHOT_VERSION, type MigrationDiff } from "./diff-calculator";
import {
  buildPreMigrationTables,
  generateMigrationPgliteSchema,
  writePgliteSchemaFile,
} from "./pglite-schema-generator";
import {
  DB_PGLITE_SCHEMA_FILE_NAME,
  formatMigrationNumber,
  type SchemaSnapshot,
  type SnapshotFieldConfig,
  type SnapshotIndexConfig,
  type TailorDBSnapshotType,
} from "./snapshot";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";
import { snapshotField } from "./test-helpers/schema-fixtures";

const TEST_BASE = path.join(__dirname, "__test_pglite_schema__");
afterAll(() => fs.rmSync(TEST_BASE, { recursive: true, force: true }));

function table(
  name: string,
  fields: Record<string, SnapshotFieldConfig>,
  indexes?: Record<string, SnapshotIndexConfig>,
): TailorDBSnapshotType {
  return {
    name,
    pluralForm: `${name}s`,
    fields: { id: snapshotField("uuid", { required: true }), ...fields },
    ...(indexes && { indexes }),
  };
}

function snapshot(...tables: TailorDBSnapshotType[]): SchemaSnapshot {
  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: "tailordb",
    createdAt: "2026-01-01T00:00:00.000Z",
    tables: Object.fromEntries(tables.map((t) => [t.name, t])),
  };
}

function diff(changes: MigrationDiff["changes"]): MigrationDiff {
  return createMockMigrationDiff({ changes, requiresMigrationScript: true });
}

const user = table(
  "User",
  {
    name: snapshotField("string", { required: true }),
    email: snapshotField("string"),
    nickname: snapshotField("string", { required: true, unique: true }),
    status: snapshotField("enum", {
      required: true,
      allowedValues: [{ value: "active" }, { value: "retired" }],
    }),
    score: snapshotField("integer", { required: true }),
  },
  { idx_name_email: { fields: ["name", "email"], unique: true } },
);

function tableNamed(tables: ReturnType<typeof buildPreMigrationTables>, name: string) {
  const found = tables.find((t) => t.name === name);
  if (!found) throw new Error(`table ${name} missing from ${tables.map((t) => t.name).join()}`);
  return found;
}

describe("buildPreMigrationTables", () => {
  test("a data-only migration keeps the snapshot as it is", () => {
    const [only] = buildPreMigrationTables(snapshot(user), diff([]));
    expect(only!.name).toBe("User");
    expect(only!.fields).toEqual(user.fields);
    expect(only!.indexes).toEqual(user.indexes);
  });

  test("required fields added by the migration are nullable while migrate.ts runs", () => {
    const tables = buildPreMigrationTables(
      snapshot(user),
      diff([
        {
          kind: "field_added",
          tableName: "User",
          fieldName: "region",
          after: snapshotField("string", { required: true, unique: true }),
        },
      ]),
    );
    expect(tableNamed(tables, "User").fields.region).toMatchObject({
      required: false,
      unique: true,
    });
  });

  test("constraints the migration tightens stay loose; ones it drops are already gone", () => {
    const tables = buildPreMigrationTables(
      snapshot(user),
      diff([
        {
          kind: "field_modified",
          tableName: "User",
          fieldName: "email",
          before: snapshotField("string"),
          after: snapshotField("string", { required: true, unique: true }),
        },
        {
          kind: "field_modified",
          tableName: "User",
          fieldName: "nickname",
          before: snapshotField("string", { required: true, unique: true }),
          after: snapshotField("string"),
        },
      ]),
    );
    const fields = tableNamed(tables, "User").fields;
    expect(fields.email).toMatchObject({ required: false, unique: false });
    expect(fields.nickname!.required).toBe(false);
    expect(fields.nickname!.unique ?? false).toBe(false);
  });

  test("a renamed field keeps the old column and relaxes the new one", () => {
    const tables = buildPreMigrationTables(
      snapshot(user),
      diff([
        {
          kind: "field_renamed",
          tableName: "User",
          fieldName: "handle",
          previousFieldName: "nickname",
          before: snapshotField("string", { required: true, unique: true }),
          after: snapshotField("string", { required: true, unique: true }),
        },
      ]),
    );
    const fields = tableNamed(tables, "User").fields;
    expect(fields.nickname).toMatchObject({ required: true, unique: true });
    expect(fields.handle).toMatchObject({ required: false, unique: false });
  });

  test("a removed field stays readable with the config the diff recorded", () => {
    const tables = buildPreMigrationTables(
      snapshot(user),
      diff([
        {
          kind: "field_removed",
          tableName: "User",
          fieldName: "score",
          before: snapshotField("integer", { required: false }),
        },
      ]),
    );
    expect(tableNamed(tables, "User").fields.score).toEqual(
      snapshotField("integer", { required: false }),
    );
  });

  test("a field whose type changes keeps its previous type", () => {
    const tables = buildPreMigrationTables(
      snapshot(user),
      diff([
        {
          kind: "field_type_modified",
          tableName: "User",
          fieldName: "score",
          before: snapshotField("integer", { required: true }),
          after: snapshotField("string", { required: true }),
        },
      ]),
    );
    expect(tableNamed(tables, "User").fields.score).toMatchObject({ type: "integer" });
  });

  test("an expand migration keeps the original field nullable next to the temporary one", () => {
    // The expand diff records the original as removed from a base that already
    // relaxed it, and the temporary field as an optional addition.
    const tables = buildPreMigrationTables(
      snapshot(user),
      diff([
        {
          kind: "field_removed",
          tableName: "User",
          fieldName: "score",
          before: snapshotField("integer", { required: false }),
        },
        {
          kind: "field_added",
          tableName: "User",
          fieldName: "scoreMigrate",
          after: snapshotField("string", { required: false, unique: false }),
        },
      ]),
    );
    const fields = tableNamed(tables, "User").fields;
    expect(fields.score).toMatchObject({ type: "integer", required: false });
    expect(fields.scoreMigrate).toMatchObject({ type: "string", required: false });
  });

  test("unique indexes the migration adds are withheld; modified ones keep their previous shape", () => {
    const tables = buildPreMigrationTables(
      snapshot(user),
      diff([
        {
          kind: "index_added",
          tableName: "User",
          indexName: "idx_email_status",
          after: { fields: ["email", "status"], unique: true },
        },
        {
          kind: "index_modified",
          tableName: "User",
          indexName: "idx_name_email",
          before: { fields: ["name", "email"], unique: true },
          after: { fields: ["name", "status"], unique: true },
        },
      ]),
    );
    expect(tableNamed(tables, "User").indexes).toEqual({
      idx_name_email: { fields: ["name", "email"], unique: true },
    });
  });

  test("removed and renamed tables are retained next to the new ones", () => {
    const log = table("Log", { message: snapshotField("string", { required: true }) });
    const tables = buildPreMigrationTables(
      snapshot(user, log),
      diff([
        { kind: "table_removed", tableName: "Log", before: log },
        {
          kind: "table_renamed",
          tableName: "Member",
          previousTableName: "User",
          before: user,
          after: { ...user, name: "Member", pluralForm: "Members" },
        },
      ]),
    );
    expect(tables.map((t) => t.name)).toEqual(["Member", "Log", "User"]);
    expect(tableNamed(tables, "User").fields).toEqual(user.fields);
  });
});

describe("generateMigrationPgliteSchema", () => {
  test("renders the namespace script module", () => {
    const content = generateMigrationPgliteSchema(snapshot(user), diff([]));
    expect(content).toContain("DO NOT EDIT");
    expect(content).toContain("export const pgliteSchema = {");
    expect(content).toContain('  "tailordb": `CREATE TABLE IF NOT EXISTS "User" (');
    expect(content).toContain('"nickname" text NOT NULL UNIQUE');
    expect(content).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "User_idx_name_email_idx" ON "User" ("name", "email");',
    );
    expect(content).toMatch(/\n} as const;\n$/);
  });
});

describe("writePgliteSchemaFile", () => {
  const dir = path.join(TEST_BASE, `write-${process.pid}`);

  test("writes db.pglite.ts into the migration directory", async () => {
    fs.mkdirSync(path.join(dir, formatMigrationNumber(1)), { recursive: true });
    const filePath = await writePgliteSchemaFile(snapshot(user), diff([]), dir, 1);
    expect(filePath).toBe(path.join(dir, formatMigrationNumber(1), DB_PGLITE_SCHEMA_FILE_NAME));
    expect(fs.readFileSync(filePath, "utf-8")).toContain("export const pgliteSchema");
  });
});

describe("agreement with db.ts", () => {
  const dir = path.join(TEST_BASE, `parity-${process.pid}`);
  const migration = diff([
    {
      kind: "field_added",
      tableName: "User",
      fieldName: "region",
      after: snapshotField("string", { required: true }),
    },
    {
      kind: "field_added",
      tableName: "User",
      fieldName: "note",
      after: snapshotField("string"),
    },
    {
      kind: "field_modified",
      tableName: "User",
      fieldName: "email",
      before: snapshotField("string"),
      after: snapshotField("string", { required: true }),
    },
    {
      kind: "field_renamed",
      tableName: "User",
      fieldName: "handle",
      previousFieldName: "nickname",
      before: snapshotField("string", { required: true, unique: true }),
      after: snapshotField("string", { required: true, unique: true }),
    },
    {
      kind: "field_removed",
      tableName: "User",
      fieldName: "score",
      before: snapshotField("integer", { required: true }),
    },
  ]);

  test("every db.ts column exists in the DDL, and a nullable read is a nullable column", async () => {
    fs.mkdirSync(path.join(dir, formatMigrationNumber(1)), { recursive: true });
    const dbTypes = fs.readFileSync(
      await writeDbTypesFile(snapshot(user), dir, 1, migration),
      "utf-8",
    );
    const ddl = generateMigrationPgliteSchema(snapshot(user), migration);

    const dbColumns = [...dbTypes.matchAll(/^ {4}(\w+): (.+);$/gm)].map((m): [string, string] => [
      m[1]!,
      m[2]!,
    ]);
    expect(dbColumns.length).toBeGreaterThan(5);
    const problems = dbColumns.flatMap(([column, type]) => {
      const line = new RegExp(`^ {2}"${column}" [^\\n]*$`, "m").exec(ddl)?.[0];
      if (!line) return [`${column}: missing from the DDL`];
      if (type.includes("| null") && line.includes("NOT NULL")) return [`${column}: NOT NULL`];
      return [];
    });
    expect(problems).toEqual([]);
  });
});

describe("generated DDL on PGlite", () => {
  const pglite = new PGlite();
  // oxlint-disable-next-line typescript/no-explicit-any -- rows are asserted by shape below
  const db = createKyselyPGlite<any>(pglite);
  const migration = diff([
    {
      kind: "field_modified",
      tableName: "User",
      fieldName: "email",
      before: snapshotField("string"),
      after: snapshotField("string", { required: true }),
    },
    {
      kind: "field_renamed",
      tableName: "User",
      fieldName: "handle",
      previousFieldName: "nickname",
      before: snapshotField("string", { required: true, unique: true }),
      after: snapshotField("string", { required: true, unique: true }),
    },
  ]);

  beforeAll(() => pglite.waitReady, 60_000);
  afterAll(() => db.destroy());

  test("stages the rows migrate.ts converts and runs the copy the scaffold would issue", async () => {
    await pglite.exec(generateSchemaDDL(buildPreMigrationTables(snapshot(user), migration)));

    await db
      .insertInto("User")
      .values([
        { name: "a", email: null, nickname: "n1", status: "active", score: 1 },
        { name: "b", email: "b@example.com", nickname: "n2", status: "active", score: 2 },
      ])
      .execute();

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("User")
        .set({ email: "unknown@example.com" })
        .where("email", "is", null)
        .execute();
      await trx
        .updateTable("User")
        .set((eb) => ({ handle: eb.ref("nickname") }))
        .execute();
    });

    const rows = await db.selectFrom("User").select(["email", "handle"]).orderBy("name").execute();
    expect(rows).toEqual([
      { email: "unknown@example.com", handle: "n1" },
      { email: "b@example.com", handle: "n2" },
    ]);
  });
});
