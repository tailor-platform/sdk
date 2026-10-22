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
import { buildPreMigrationSnapshot } from "./pre-migration-schema";
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

describe("buildPreMigrationSnapshot", () => {
  test("keeps type attributes besides fields and indexes, with the relaxations applied", () => {
    const withSettings = { ...user, settings: { aggregation: true, publishEvents: true } };
    const result = buildPreMigrationSnapshot(
      snapshot(withSettings),
      diff([
        {
          kind: "field_added",
          tableName: "User",
          fieldName: "region",
          after: snapshotField("string", { required: true }),
        },
      ]),
    );

    expect(result.namespace).toBe("tailordb");
    expect(result.tables.User).toMatchObject({
      pluralForm: "Users",
      settings: { aggregation: true, publishEvents: true },
    });
    expect(result.tables.User!.fields.region).toMatchObject({ required: false });
  });

  test("retains a table the migration removes so the script can still read it", () => {
    const legacy = table("Legacy", { note: snapshotField("string") });
    const result = buildPreMigrationSnapshot(
      snapshot(user, legacy),
      diff([{ kind: "table_removed", tableName: "Legacy", before: legacy }]),
    );

    expect(Object.keys(result.tables)).toEqual(["User", "Legacy"]);
    expect(result.tables.Legacy).toEqual(legacy);
  });

  test("keeps a table named __proto__", () => {
    const legacy = table("__proto__", { note: snapshotField("string") });
    const result = buildPreMigrationSnapshot(snapshot(user, legacy), diff([]));

    expect(Object.keys(result.tables)).toEqual(["User", "__proto__"]);
  });

  test("keeps the previous table scripts while a field's type change is pending", () => {
    const result = buildPreMigrationSnapshot(
      snapshot({ ...user, typeHookExpr: { create: "before" } }),
      diff([
        {
          kind: "field_type_modified",
          tableName: "User",
          fieldName: "score",
          before: snapshotField("integer", { required: true }),
          after: snapshotField("float", { required: true }),
        },
        {
          kind: "table_scripts_modified",
          tableName: "User",
          before: { typeHookExpr: { create: "before" } },
          after: { typeHookExpr: { create: "after" } },
        },
      ]),
    );

    expect(result.tables.User!.typeHookExpr).toEqual({ create: "before" });
    expect(result.tables.User!.fields.score).toMatchObject({ type: "integer" });
  });

  test("keeps removed nested members and relaxes a renamed one, as the deploy's Pre-phase does", () => {
    const before = snapshotField("nested", {
      fields: {
        zip: snapshotField("string", { required: true }),
        geo: snapshotField("nested", {
          fields: {
            lat: snapshotField("float", { required: true }),
            lng: snapshotField("float", { required: true }),
          },
        }),
      },
    });
    const after = snapshotField("nested", {
      fields: {
        zipCode: snapshotField("string", { required: true }),
        geo: snapshotField("nested", {
          fields: { lat: snapshotField("float", { required: true }) },
        }),
      },
    });
    const result = buildPreMigrationSnapshot(
      snapshot(table("Customer", { address: before })),
      diff([
        {
          kind: "field_modified",
          tableName: "Customer",
          fieldName: "address",
          before,
          after,
          memberRenames: [{ previousPath: ["zip"], path: ["zipCode"] }],
        },
      ]),
    );

    const address = result.tables.Customer!.fields.address!;
    expect(address.fields?.zipCode).toMatchObject({ required: false });
    expect(address.fields?.zip).toMatchObject({ type: "string", required: true });
    expect(Object.keys(address.fields?.geo?.fields ?? {})).toEqual(["lat", "lng"]);
    expect(after.fields?.zipCode).toMatchObject({ required: true });
    expect(Object.keys(after.fields?.geo?.fields ?? {})).toEqual(["lat"]);
  });
});

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

describe("buildPreMigrationTables relations", () => {
  const owner = (extra: Partial<SnapshotFieldConfig> = {}) =>
    snapshotField("uuid", { required: true, foreignKey: true, foreignKeyType: "User", ...extra });
  const post = (fields: Record<string, SnapshotFieldConfig>) => table("Post", fields);

  test("a relation whose target is in the Pre-phase schema keeps its reference", () => {
    const tables = buildPreMigrationTables(snapshot(user, post({ ownerID: owner() })), diff([]));
    expect(tableNamed(tables, "Post").fields.ownerID).toMatchObject({
      foreignKey: true,
      foreignKeyType: "User",
    });
  });

  test("a relation keeps its reference when the target is only retained for the script", () => {
    const tables = buildPreMigrationTables(
      snapshot(user, post({ ownerID: owner() })),
      diff([{ kind: "table_removed", tableName: "User", before: user }]),
    );
    expect(tableNamed(tables, "Post").fields.ownerID).toMatchObject({ foreignKey: true });
  });

  test("a relation to a table outside the Pre-phase schema loses its reference", () => {
    const tables = buildPreMigrationTables(
      snapshot(post({ ownerID: owner({ foreignKeyType: "Ghost" }) })),
      diff([]),
    );
    const ownerID = tableNamed(tables, "Post").fields.ownerID;
    expect(ownerID).toMatchObject({ type: "uuid", required: true });
    expect(ownerID).not.toHaveProperty("foreignKey");
    expect(ownerID).not.toHaveProperty("foreignKeyType");
  });

  test("a relation loses its reference while a pending type change leaves it a different type from the target", () => {
    const toNickname = (type: string) =>
      snapshotField(type, {
        foreignKey: true,
        foreignKeyType: "User",
        foreignKeyField: "nickname",
      });
    const tables = buildPreMigrationTables(
      snapshot(user, post({ author: toNickname("string") })),
      diff([
        {
          kind: "field_type_modified",
          tableName: "Post",
          fieldName: "author",
          before: toNickname("integer"),
          after: toNickname("string"),
        },
      ]),
    );
    const author = tableNamed(tables, "Post").fields.author;
    expect(author).toMatchObject({ type: "integer" });
    expect(author).not.toHaveProperty("foreignKey");
  });

  test("a relation keeps its reference while a pending type change leaves it the type of its target", () => {
    const toNickname = (type: string) =>
      snapshotField(type, {
        foreignKey: true,
        foreignKeyType: "User",
        foreignKeyField: "nickname",
      });
    const tables = buildPreMigrationTables(
      snapshot(user, post({ author: toNickname("string") })),
      diff([
        {
          kind: "field_type_modified",
          tableName: "Post",
          fieldName: "author",
          before: toNickname("string"),
          after: toNickname("string"),
        },
      ]),
    );
    expect(tableNamed(tables, "Post").fields.author).toMatchObject({
      foreignKey: true,
      foreignKeyField: "nickname",
    });
  });

  test("a relation to a field whose unique constraint is still withheld loses its reference", () => {
    const withUniqueNickname = {
      ...user,
      fields: {
        ...user.fields,
        nickname: snapshotField("string", { required: true, unique: true }),
      },
    };
    const tables = buildPreMigrationTables(
      snapshot(
        withUniqueNickname,
        post({
          author: snapshotField("string", {
            foreignKey: true,
            foreignKeyType: "User",
            foreignKeyField: "nickname",
          }),
        }),
      ),
      diff([
        {
          kind: "field_modified",
          tableName: "User",
          fieldName: "nickname",
          before: snapshotField("string", { required: true }),
          after: snapshotField("string", { required: true, unique: true }),
        },
      ]),
    );
    expect(tableNamed(tables, "User").fields.nickname).toMatchObject({ unique: false });
    expect(tableNamed(tables, "Post").fields.author).not.toHaveProperty("foreignKey");
  });

  test("a relation the migration retargets loses its reference, since its stored values still point at the old target", () => {
    const person = { ...user, name: "Person", pluralForm: "People" };
    const tables = buildPreMigrationTables(
      snapshot(user, post({ ownerID: owner() })),
      diff([
        {
          kind: "table_renamed",
          tableName: "Person",
          previousTableName: "User",
          before: user,
          after: person,
        },
        {
          kind: "field_modified",
          tableName: "Post",
          fieldName: "ownerID",
          before: owner(),
          after: owner({ foreignKeyType: "Person" }),
        },
      ]),
    );
    const ownerID = tableNamed(tables, "Post").fields.ownerID;
    expect(ownerID).toMatchObject({ type: "uuid", required: true });
    expect(ownerID).not.toHaveProperty("foreignKey");
  });

  test("a relation inside a nested field loses its reference when the migration retargets it, and the other members keep theirs", () => {
    const person = { ...user, name: "Person", pluralForm: "People" };
    const nested = (target: string) =>
      snapshotField("nested", {
        fields: {
          owner: owner({ foreignKeyType: target }),
          editor: owner(),
        },
      });
    const tables = buildPreMigrationTables(
      snapshot(user, post({ info: nested("User") })),
      diff([
        {
          kind: "table_renamed",
          tableName: "Person",
          previousTableName: "User",
          before: user,
          after: person,
        },
        {
          kind: "field_modified",
          tableName: "Post",
          fieldName: "info",
          before: nested("User"),
          after: nested("Person"),
        },
      ]),
    );
    const members = tableNamed(tables, "Post").fields.info!.fields!;
    expect(members.owner).not.toHaveProperty("foreignKey");
    expect(members.editor).toMatchObject({ foreignKey: true, foreignKeyType: "User" });
  });

  test("a relation the migration adds to an existing field keeps its reference, since there is no old target to repair", () => {
    const tables = buildPreMigrationTables(
      snapshot(user, post({ ownerID: owner() })),
      diff([
        {
          kind: "field_modified",
          tableName: "Post",
          fieldName: "ownerID",
          before: snapshotField("uuid", { required: true }),
          after: owner(),
        },
      ]),
    );
    expect(tableNamed(tables, "Post").fields.ownerID).toMatchObject({
      foreignKey: true,
      foreignKeyType: "User",
    });
  });

  test("a relation the migration adds to a member of a nested field keeps its reference", () => {
    const nested = (member: SnapshotFieldConfig) =>
      snapshotField("nested", { fields: { owner: member } });
    const tables = buildPreMigrationTables(
      snapshot(user, post({ info: nested(owner()) })),
      diff([
        {
          kind: "field_modified",
          tableName: "Post",
          fieldName: "info",
          before: nested(snapshotField("uuid", { required: true })),
          after: nested(owner()),
        },
      ]),
    );
    expect(tableNamed(tables, "Post").fields.info!.fields!.owner).toMatchObject({
      foreignKey: true,
    });
  });

  test("a relation keeps its reference when the migration modifies the field without retargeting it", () => {
    const tables = buildPreMigrationTables(
      snapshot(user, post({ ownerID: owner() })),
      diff([
        {
          kind: "field_modified",
          tableName: "Post",
          fieldName: "ownerID",
          before: owner({ required: false }),
          after: owner(),
        },
      ]),
    );
    expect(tableNamed(tables, "Post").fields.ownerID).toMatchObject({ foreignKey: true });
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
      'CREATE UNIQUE INDEX IF NOT EXISTS "User_idx_name_email_034aa1eb_idx" ON "User" ("name", "email");',
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

describe("generated DDL on PGlite", { timeout: 30_000 }, () => {
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

  test("stages children after their parents, and rejects a child whose parent is missing", async () => {
    const post = table("Post", {
      ownerID: snapshotField("uuid", { required: true, foreignKey: true, foreignKeyType: "User" }),
    });
    const pre = new PGlite();
    await pre.exec(generateSchemaDDL(buildPreMigrationTables(snapshot(user, post), diff([]))));
    await expect(
      pre.exec(`INSERT INTO "Post" ("ownerID") VALUES (gen_random_uuid())`),
    ).rejects.toThrow(/foreign key/);
    await pre.close();
  });

  test("stages the rows that still point at the old parent while the migration retargets a relation to its renamed table", async () => {
    const person = { ...user, name: "Person", pluralForm: "People" };
    const order = table("Order", {
      ownerID: snapshotField("uuid", { required: true, foreignKey: true, foreignKeyType: "User" }),
    });
    const pre = new PGlite();
    await pre.exec(
      generateSchemaDDL(
        buildPreMigrationTables(
          snapshot(user, order),
          diff([
            {
              kind: "table_renamed",
              tableName: "Person",
              previousTableName: "User",
              before: user,
              after: person,
            },
            {
              kind: "field_modified",
              tableName: "Order",
              fieldName: "ownerID",
              before: snapshotField("uuid", {
                required: true,
                foreignKey: true,
                foreignKeyType: "User",
              }),
              after: snapshotField("uuid", {
                required: true,
                foreignKey: true,
                foreignKeyType: "Person",
              }),
            },
          ]),
        ),
      ),
    );
    const { rows } = await pre.query<{ id: string }>(
      `INSERT INTO "User" (name, status, nickname, score) VALUES ('a', 'active', 'n', 1) RETURNING id`,
    );
    await pre.query(`INSERT INTO "Order" ("ownerID") VALUES ($1)`, [rows[0]!.id]);
    const staged = await pre.query(`SELECT 1 FROM "Order"`);
    expect(staged.rows).toHaveLength(1);
    await pre.close();
  });

  test("stages the rows whose nested relation still points at the old parent when the migration retargets it", async () => {
    const person = { ...user, name: "Person", pluralForm: "People" };
    const member = (target: string) =>
      snapshotField("uuid", { foreignKey: true, foreignKeyType: target });
    const info = (target: string) =>
      snapshotField("nested", { required: true, fields: { owner: member(target) } });
    const pre = new PGlite();
    await pre.exec(
      generateSchemaDDL(
        buildPreMigrationTables(
          snapshot(user, table("Order", { info: info("User") })),
          diff([
            {
              kind: "table_renamed",
              tableName: "Person",
              previousTableName: "User",
              before: user,
              after: person,
            },
            {
              kind: "field_modified",
              tableName: "Order",
              fieldName: "info",
              before: info("User"),
              after: info("Person"),
            },
          ]),
        ),
      ),
    );
    const { rows } = await pre.query<{ id: string }>(
      `INSERT INTO "User" (name, status, nickname, score) VALUES ('a', 'active', 'n', 1) RETURNING id`,
    );
    await pre.query(`INSERT INTO "Order" (info) VALUES ($1::jsonb)`, [
      JSON.stringify({ owner: rows[0]!.id }),
    ]);
    const staged = await pre.query(`SELECT 1 FROM "Order"`);
    expect(staged.rows).toHaveLength(1);
    await pre.close();
  });

  test("the module still renders when a relation cannot be a foreign key", () => {
    const content = generateMigrationPgliteSchema(
      snapshot(
        table("Post", {
          ownerID: snapshotField("uuid", {
            required: true,
            foreignKey: true,
            foreignKeyType: "Ghost",
          }),
        }),
      ),
      diff([]),
    );
    expect(content).toContain('CREATE TABLE IF NOT EXISTS "Post"');
    expect(content).not.toContain("REFERENCES");
  });
});
