import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, test } from "vitest";
import {
  generateSchemaDDL,
  generateTableDDL,
  mapFieldTypeToPostgresType,
  type DDLFieldConfig,
  type DDLTableConfig,
  dropUnresolvableReferences,
} from "./tailordb-ddl";

const openDatabases: PGlite[] = [];

function newPglite(): PGlite {
  const db = new PGlite();
  openDatabases.push(db);
  return db;
}

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((db) => db.close()));
});

function table(
  fields: Record<string, DDLFieldConfig>,
  options: Partial<Omit<DDLTableConfig, "fields">> = {},
): DDLTableConfig {
  return { name: "Item", fields: { id: { type: "uuid", required: true }, ...fields }, ...options };
}

function columnLine(fields: Record<string, DDLFieldConfig>, column: string): string {
  const [create] = generateTableDDL(table(fields)).filter((s) => s.startsWith("CREATE TABLE"));
  const line = create!.split("\n").find((l) => l.trimStart().startsWith(`"${column}"`));
  if (!line) throw new Error(`column ${column} missing in:\n${create}`);
  return line.trim().replace(/,$/, "");
}

describe("mapFieldTypeToPostgresType", () => {
  test.each([
    ["uuid", "uuid"],
    ["string", "text"],
    ["enum", "text"],
    ["boolean", "boolean"],
    ["bool", "boolean"],
    ["integer", "integer"],
    ["float", "double precision"],
    ["decimal", "numeric"],
    ["date", "date"],
    ["datetime", "timestamptz"],
    ["time", "time"],
    ["nested", "jsonb"],
  ] as const)("maps %s to %s", (fieldType, expected) => {
    expect(mapFieldTypeToPostgresType(fieldType)).toBe(expected);
  });

  test("rejects an unknown field type", () => {
    expect(() => mapFieldTypeToPostgresType("money")).toThrow(/money/);
  });
});

describe("generateTableDDL", () => {
  test("emits the id column once, as the primary key, even though it is in fields", () => {
    const statements = generateTableDDL(table({ name: { type: "string", required: true } }));
    expect(statements).toEqual([
      [
        'CREATE TABLE IF NOT EXISTS "Item" (',
        '  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  "name" text NOT NULL',
        ")",
      ].join("\n"),
    ]);
  });

  test("required fields are NOT NULL, optional fields are nullable", () => {
    expect(columnLine({ a: { type: "string", required: true } }, "a")).toBe('"a" text NOT NULL');
    expect(columnLine({ a: { type: "string", required: false } }, "a")).toBe('"a" text');
    expect(columnLine({ a: { type: "string" } }, "a")).toBe('"a" text');
  });

  test("decimal columns round to the configured scale, six digits when omitted", () => {
    expect(columnLine({ price: { type: "decimal", required: true } }, "price")).toBe(
      '"price" numeric(1000, 6) NOT NULL',
    );
    expect(columnLine({ price: { type: "decimal", scale: 2 } }, "price")).toBe(
      '"price" numeric(1000, 2)',
    );
    expect(columnLine({ prices: { type: "decimal", scale: 0, array: true } }, "prices")).toBe(
      '"prices" numeric(1000, 0)[]',
    );
  });

  test("unique fields get a UNIQUE constraint", () => {
    expect(columnLine({ email: { type: "string", required: true, unique: true } }, "email")).toBe(
      '"email" text NOT NULL UNIQUE',
    );
  });

  test("scalar arrays become Postgres arrays; nested arrays stay jsonb", () => {
    expect(columnLine({ tags: { type: "string", required: true, array: true } }, "tags")).toBe(
      '"tags" text[] NOT NULL',
    );
    expect(columnLine({ ids: { type: "uuid", array: true } }, "ids")).toBe('"ids" uuid[]');
    expect(
      columnLine(
        {
          items: { type: "nested", required: true, array: true, fields: { n: { type: "string" } } },
        },
        "items",
      ),
    ).toBe('"items" jsonb NOT NULL');
  });

  describe("defaults", () => {
    test("string defaults are quoted and escaped, non-text types are cast", () => {
      expect(columnLine({ s: { type: "string", required: true, default: "it's" } }, "s")).toBe(
        "\"s\" text NOT NULL DEFAULT 'it''s'",
      );
      expect(columnLine({ e: { type: "enum", required: true, default: "ACTIVE" } }, "e")).toBe(
        "\"e\" text NOT NULL DEFAULT 'ACTIVE'",
      );
      expect(
        columnLine(
          { u: { type: "uuid", required: true, default: "0f5b7d4e-0000-4000-8000-000000000000" } },
          "u",
        ),
      ).toBe("\"u\" uuid NOT NULL DEFAULT '0f5b7d4e-0000-4000-8000-000000000000'::uuid");
    });

    test("numbers and booleans are emitted as literals", () => {
      expect(columnLine({ n: { type: "integer", required: true, default: 0 } }, "n")).toBe(
        '"n" integer NOT NULL DEFAULT 0',
      );
      expect(columnLine({ f: { type: "float", required: true, default: -1.5 } }, "f")).toBe(
        '"f" double precision NOT NULL DEFAULT -1.5',
      );
      expect(columnLine({ b: { type: "boolean", required: true, default: true } }, "b")).toBe(
        '"b" boolean NOT NULL DEFAULT TRUE',
      );
    });

    test('"now" on a time type is the current time, not the literal string', () => {
      expect(columnLine({ t: { type: "datetime", required: true, default: "now" } }, "t")).toBe(
        '"t" timestamptz NOT NULL DEFAULT now()',
      );
      expect(columnLine({ d: { type: "date", required: true, default: "now" } }, "d")).toBe(
        '"d" date NOT NULL DEFAULT CURRENT_DATE',
      );
      expect(columnLine({ h: { type: "time", required: true, default: "now" } }, "h")).toBe(
        '"h" time NOT NULL DEFAULT LOCALTIME',
      );
      expect(columnLine({ s: { type: "string", required: true, default: "now" } }, "s")).toBe(
        "\"s\" text NOT NULL DEFAULT 'now'",
      );
    });

    test("Date instances and date strings are cast to the column type", () => {
      const at = new Date("2024-01-02T03:04:05.000Z");
      expect(columnLine({ t: { type: "datetime", required: true, default: at } }, "t")).toBe(
        "\"t\" timestamptz NOT NULL DEFAULT '2024-01-02T03:04:05.000Z'::timestamptz",
      );
      expect(columnLine({ d: { type: "date", required: true, default: "2024-01-02" } }, "d")).toBe(
        "\"d\" date NOT NULL DEFAULT '2024-01-02'::date",
      );
    });

    test("array defaults use an ARRAY constructor, empty arrays an empty literal", () => {
      expect(
        columnLine(
          { tags: { type: "string", required: true, array: true, default: ["a", "b"] } },
          "tags",
        ),
      ).toBe("\"tags\" text[] NOT NULL DEFAULT ARRAY['a', 'b']::text[]");
      expect(
        columnLine({ ns: { type: "integer", required: true, array: true, default: [] } }, "ns"),
      ).toBe("\"ns\" integer[] NOT NULL DEFAULT '{}'::integer[]");
    });

    test("rejects a default that cannot be rendered, naming the table and field", () => {
      expect(() =>
        columnLine({ n: { type: "integer", required: true, default: NaN } }, "n"),
      ).toThrow(/"Item"\."n"/);
      expect(() =>
        columnLine({ s: { type: "string", required: true, default: { a: 1 } } }, "s"),
      ).toThrow(/"s"/);
    });
  });

  test("a required field filled by a create hook has no NOT NULL, because the hook does not run", () => {
    expect(
      columnLine({ slug: { type: "string", required: true, hooks: { create: {} } } }, "slug"),
    ).toBe('"slug" text');
    expect(
      columnLine({ slug: { type: "string", required: true, hooks: { update: {} } } }, "slug"),
    ).toBe('"slug" text NOT NULL');
    expect(
      columnLine({ slug: { type: "string", required: true, optionalOnCreate: true } }, "slug"),
    ).toBe('"slug" text');
  });

  test("a create hook combined with a default keeps NOT NULL, the default stands in for the hook", () => {
    expect(
      columnLine(
        { at: { type: "datetime", required: true, default: "now", hooks: { create: {} } } },
        "at",
      ),
    ).toBe('"at" timestamptz NOT NULL DEFAULT now()');
  });

  describe("serial", () => {
    test("integer serial is an identity column with the configured range", () => {
      expect(
        columnLine({ seq: { type: "integer", required: true, serial: { start: 1 } } }, "seq"),
      ).toBe('"seq" integer GENERATED BY DEFAULT AS IDENTITY (START WITH 1 MINVALUE 1)');
      expect(
        columnLine(
          { seq: { type: "integer", required: true, serial: { start: 10, maxValue: 999 } } },
          "seq",
        ),
      ).toBe(
        '"seq" integer GENERATED BY DEFAULT AS IDENTITY (START WITH 10 MINVALUE 10 MAXVALUE 999)',
      );
    });

    test("a serial starting at zero lowers the sequence minimum, which defaults to one", () => {
      expect(columnLine({ seq: { type: "integer", serial: { start: 0 } } }, "seq")).toBe(
        '"seq" integer GENERATED BY DEFAULT AS IDENTITY (START WITH 0 MINVALUE 0)',
      );
      const [sequence] = generateTableDDL(table({ n: { type: "string", serial: { start: 0 } } }));
      expect(sequence).toBe(
        'CREATE SEQUENCE IF NOT EXISTS "Item_n_88d982cf_seq" START WITH 0 MINVALUE 0',
      );
    });

    test("a unique integer serial keeps its UNIQUE constraint", () => {
      expect(
        columnLine(
          { seq: { type: "integer", required: true, unique: true, serial: { start: 1 } } },
          "seq",
        ),
      ).toBe('"seq" integer GENERATED BY DEFAULT AS IDENTITY (START WITH 1 MINVALUE 1) UNIQUE');
    });

    test("string serial with a zero-padded format creates a sequence and a formatted default", () => {
      const statements = generateTableDDL(
        table({
          invoiceNumber: {
            type: "string",
            required: true,
            serial: { start: 1000, maxValue: 99999, format: "INV-%05d" },
          },
        }),
      );
      expect(statements[0]).toBe(
        'CREATE SEQUENCE IF NOT EXISTS "Item_invoiceNumber_19d98bb7_seq" START WITH 1000 MINVALUE 1000 MAXVALUE 99999',
      );
      expect(statements[1]).toContain(
        "\"invoiceNumber\" text NOT NULL DEFAULT ('INV-' || translate(format('%5s', nextval('\"Item_invoiceNumber_19d98bb7_seq\"')), ' ', '0'))",
      );
    });

    test("string serial formats: plain %d, space-padded width, suffix text, and a quote in the text", () => {
      expect(columnLine({ n: { type: "string", serial: { start: 1, format: "%d" } } }, "n")).toBe(
        '"n" text DEFAULT (nextval(\'"Item_n_88d982cf_seq"\')::text)',
      );
      expect(columnLine({ n: { type: "string", serial: { start: 1, format: "%3d" } } }, "n")).toBe(
        "\"n\" text DEFAULT (format('%3s', nextval('\"Item_n_88d982cf_seq\"')))",
      );
      expect(columnLine({ n: { type: "string", serial: { start: 1, format: "A%dB" } } }, "n")).toBe(
        "\"n\" text DEFAULT ('A' || nextval('\"Item_n_88d982cf_seq\"')::text || 'B')",
      );
      expect(
        columnLine({ n: { type: "string", serial: { start: 1, format: "it's-%d" } } }, "n"),
      ).toBe("\"n\" text DEFAULT ('it''s-' || nextval('\"Item_n_88d982cf_seq\"')::text)");
    });

    test("a unique string serial keeps its UNIQUE constraint", () => {
      expect(
        columnLine(
          { n: { type: "string", required: true, unique: true, serial: { start: 1 } } },
          "n",
        ),
      ).toBe('"n" text NOT NULL UNIQUE DEFAULT (nextval(\'"Item_n_88d982cf_seq"\')::text)');
    });

    test("string serial without a format is the bare sequence value", () => {
      expect(columnLine({ n: { type: "string", serial: { start: 1 } } }, "n")).toBe(
        '"n" text DEFAULT (nextval(\'"Item_n_88d982cf_seq"\')::text)',
      );
    });

    test("hexadecimal serial formats render through to_hex, padded like %d", () => {
      expect(columnLine({ n: { type: "string", serial: { start: 1, format: "%x" } } }, "n")).toBe(
        '"n" text DEFAULT (to_hex(nextval(\'"Item_n_88d982cf_seq"\')))',
      );
      expect(
        columnLine({ n: { type: "string", serial: { start: 1, format: "0x%04X" } } }, "n"),
      ).toBe(
        "\"n\" text DEFAULT ('0x' || translate(format('%4s', upper(to_hex(nextval('\"Item_n_88d982cf_seq\"')))), ' ', '0'))",
      );
    });

    test("rejects serial formats it cannot reproduce", () => {
      for (const format of ["%o", "%d-%d", "no-specifier", "%s"]) {
        expect(() =>
          generateTableDDL(table({ n: { type: "string", serial: { start: 1, format } } })),
        ).toThrow(/"n"/);
      }
    });
  });

  test("unique composite indexes become unique indexes; other indexes are skipped", () => {
    const statements = generateTableDDL(
      table(
        { a: { type: "string" }, b: { type: "string" } },
        {
          indexes: {
            idx_a_b: { fields: ["a", "b"], unique: true },
            by_a: { fields: ["a"], unique: false },
            by_b: { fields: ["b"] },
          },
        },
      ),
    );
    expect(statements).toHaveLength(2);
    expect(statements[1]).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Item_idx_a_b_82fba4e7_idx" ON "Item" ("a", "b")',
    );
  });

  test("string serial sequences are owned by their column so dropping the table drops them", () => {
    const statements = generateTableDDL(table({ n: { type: "string", serial: { start: 1 } } }));
    expect(statements).toContain('ALTER SEQUENCE "Item_n_88d982cf_seq" OWNED BY "Item"."n"');
    expect(statements.indexOf('ALTER SEQUENCE "Item_n_88d982cf_seq" OWNED BY "Item"."n"')).toBe(
      statements.findIndex((statement) => statement.startsWith("CREATE TABLE")) + 1,
    );
  });

  test("integer serials use an identity column, which needs no ALTER SEQUENCE", () => {
    const statements = generateTableDDL(table({ n: { type: "integer", serial: { start: 1 } } }));
    expect(statements.some((statement) => statement.startsWith("ALTER SEQUENCE"))).toBe(false);
  });

  test("identifiers are double-quoted with embedded quotes doubled", () => {
    const [create] = generateTableDDL({
      name: 'We"ird',
      fields: { id: { type: "uuid" }, 'co"l': { type: "string" } },
    });
    expect(create).toContain('CREATE TABLE IF NOT EXISTS "We""ird" (');
    expect(create).toContain('"co""l" text');
  });

  test("derived sequence and index names are shortened to fit Postgres, distinctly per source", () => {
    const tableName = "PurchaseOrderApprovalWorkflowStepAssignment";
    const ddl = (field: string) =>
      generateTableDDL({
        name: tableName,
        fields: { id: { type: "uuid" }, [field]: { type: "string", serial: { start: 1 } } },
        indexes: { [`${field}_by_step`]: { fields: [field, "id"], unique: true } },
      });
    const [sequence, create, , index] = ddl("approvalSequenceNumber");
    const sequenceName = /SEQUENCE IF NOT EXISTS "([^"]+)"/.exec(sequence!)![1]!;
    expect(sequenceName.length).toBeLessThanOrEqual(63);
    expect(sequenceName).toMatch(/_[0-9a-f]{8}_seq$/);
    expect(sequenceName.startsWith(`${tableName}_`)).toBe(true);
    expect(create).toContain(`nextval('"${sequenceName}"')`);
    expect(/INDEX IF NOT EXISTS "([^"]+)"/.exec(index!)![1]!.length).toBeLessThanOrEqual(63);

    const [otherSequence] = ddl("approvalSequenceNumberOfTheSecondKind");
    expect(otherSequence).not.toBe(sequence);
    expect(ddl("approvalSequenceNumber")[0]).toBe(sequence);
  });

  test("table and column names are passed through untouched; Postgres truncates them consistently", () => {
    const long = "x".repeat(64);
    const [create] = generateTableDDL({
      name: long,
      fields: { id: { type: "uuid" }, [long]: { type: "string" } },
    });
    expect(create).toContain(`CREATE TABLE IF NOT EXISTS "${long}"`);
    expect(create).toContain(`"${long}" text`);
  });
});

describe("generateSchemaDDL", () => {
  test("terminates every statement and separates tables with a blank line", () => {
    const script = generateSchemaDDL([
      { name: "A", fields: { id: { type: "uuid" }, n: { type: "string", serial: { start: 1 } } } },
      { name: "B", fields: { id: { type: "uuid" } } },
    ]);
    expect(script).toBe(
      [
        'CREATE SEQUENCE IF NOT EXISTS "A_n_baa9714b_seq" START WITH 1 MINVALUE 1;',
        'CREATE TABLE IF NOT EXISTS "A" (',
        '  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  "n" text DEFAULT (nextval(\'"A_n_baa9714b_seq"\')::text)',
        ");",
        'ALTER SEQUENCE "A_n_baa9714b_seq" OWNED BY "A"."n";',
        "",
        'CREATE TABLE IF NOT EXISTS "B" (',
        '  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()',
        ");",
      ].join("\n"),
    );
  });

  test("is empty for no tables", () => {
    expect(generateSchemaDDL([])).toBe("");
  });
});

describe("foreign keys", { timeout: 30_000 }, () => {
  const parent: DDLTableConfig = { name: "Parent", fields: { id: { type: "uuid" } } };
  const ref = (foreignKeyType: string, extra: Partial<DDLFieldConfig> = {}): DDLFieldConfig => ({
    type: "uuid",
    required: true,
    foreignKey: true,
    foreignKeyType,
    ...extra,
  });

  async function pglite(script: string): Promise<PGlite> {
    const db = newPglite();
    await db.exec(script);
    return db;
  }

  test("a scalar reference column points at the id of its table by default", () => {
    const script = generateSchemaDDL([
      parent,
      { name: "Child", fields: { id: { type: "uuid" }, parentID: ref("Parent") } },
    ]);
    expect(script).toContain('"parentID" uuid NOT NULL REFERENCES "Parent" ("id")');
  });

  test("a scalar reference follows foreignKeyField", () => {
    const script = generateSchemaDDL([
      { name: "Parent", fields: { id: { type: "uuid" }, code: { type: "string", unique: true } } },
      {
        name: "Child",
        fields: {
          id: { type: "uuid" },
          parentCode: ref("Parent", { type: "string", foreignKeyField: "code" }),
        },
      },
    ]);
    expect(script).toContain('"parentCode" text NOT NULL REFERENCES "Parent" ("code")');
  });

  test("tables are created after the tables they reference", () => {
    const script = generateSchemaDDL([
      { name: "Child", fields: { id: { type: "uuid" }, parentID: ref("Parent") } },
      parent,
    ]);
    expect(script.indexOf('"Parent" (')).toBeLessThan(script.indexOf('"Child" ('));
  });

  test("a self reference is inline", () => {
    const script = generateSchemaDDL([
      {
        name: "Node",
        fields: { id: { type: "uuid" }, parentID: ref("Node", { required: false }) },
      },
    ]);
    expect(script).toContain('"parentID" uuid REFERENCES "Node" ("id")');
  });

  test("a cycle is closed by a constraint added after both tables exist", async () => {
    const script = generateSchemaDDL([
      { name: "A", fields: { id: { type: "uuid" }, bID: ref("B", { required: false }) } },
      { name: "B", fields: { id: { type: "uuid" }, aID: ref("A", { required: false }) } },
    ]);
    expect(script).toContain("ADD CONSTRAINT");
    const db = await pglite(script);
    await expect(
      db.exec(`INSERT INTO "A" (id, "bID") VALUES (gen_random_uuid(), gen_random_uuid())`),
    ).rejects.toThrow(/foreign key/);
  });

  test("a scalar reference rejects a missing parent in PGlite", async () => {
    const db = await pglite(
      generateSchemaDDL([
        parent,
        { name: "Child", fields: { id: { type: "uuid" }, parentID: ref("Parent") } },
      ]),
    );
    await expect(
      db.exec(`INSERT INTO "Child" ("parentID") VALUES (gen_random_uuid())`),
    ).rejects.toThrow(/foreign key/);
  });

  test("an array reference rejects an element with no parent and accepts existing ones", async () => {
    const db = await pglite(
      generateSchemaDDL([
        parent,
        {
          name: "Child",
          fields: {
            id: { type: "uuid" },
            parentIDs: ref("Parent", { array: true, required: false }),
          },
        },
      ]),
    );
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO "Parent" DEFAULT VALUES RETURNING id`,
    );
    const id = rows[0]!.id;
    await db.query(`INSERT INTO "Child" ("parentIDs") VALUES ($1)`, [`{${id}}`]);
    await expect(
      db.query(`INSERT INTO "Child" ("parentIDs") VALUES ($1)`, [`{${id},${crypto.randomUUID()}}`]),
    ).rejects.toThrow(/violates foreign key constraints: .* not found in "Parent"."id"/);
  });

  test("references inside nested fields, including nested arrays, are checked", async () => {
    const db = await pglite(
      generateSchemaDDL([
        parent,
        {
          name: "Child",
          fields: {
            id: { type: "uuid" },
            info: {
              type: "nested",
              fields: {
                owner: ref("Parent", { required: false }),
                items: { type: "nested", array: true, fields: { parentID: ref("Parent") } },
              },
            },
          },
        },
      ]),
    );
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO "Parent" DEFAULT VALUES RETURNING id`,
    );
    const id = rows[0]!.id;
    const insert = (info: unknown) =>
      db.query(`INSERT INTO "Child" (info) VALUES ($1::jsonb)`, [JSON.stringify(info)]);
    await insert({ owner: id, items: [{ parentID: id }] });
    await expect(insert({ owner: crypto.randomUUID(), items: [] })).rejects.toThrow(/not found/);
    await expect(
      insert({ items: [{ parentID: id }, { parentID: crypto.randomUUID() }] }),
    ).rejects.toThrow(/not found/);
  });

  describe("unique fields inside nested fields", () => {
    const nestedUnique = (): DDLTableConfig => ({
      name: "Order",
      fields: {
        id: { type: "uuid" },
        info: {
          type: "nested",
          required: false,
          fields: {
            code: { type: "string", unique: true },
            seq: { type: "integer", unique: true },
            group: {
              type: "nested",
              fields: { token: { type: "uuid", unique: true } },
            },
            note: { type: "string" },
          },
        },
      },
    });
    const insertInfo = (db: PGlite, info: unknown) =>
      db.query(`INSERT INTO "Order" (info) VALUES ($1::jsonb)`, [JSON.stringify(info)]);

    const token = crypto.randomUUID();
    test.each([
      ["a string member", { code: "dup" }],
      ["an integer member", { seq: 7 }],
      ["a member of a nested object", { group: { token } }],
    ])("rejects a second row with the same value of %s", async (_label, info) => {
      const db = await pglite(generateSchemaDDL([nestedUnique()]));

      await insertInfo(db, info);
      await expect(insertInfo(db, info)).rejects.toThrow(/duplicate key value violates unique/);
    });

    test("compares a decimal member as a number without rounding it to its scale, as the platform does", async () => {
      const db = await pglite(
        generateSchemaDDL([
          {
            name: "Order",
            fields: {
              id: { type: "uuid" },
              info: {
                type: "nested",
                fields: { amount: { type: "decimal", scale: 2, unique: true } },
              },
            },
          },
        ]),
      );

      await insertInfo(db, { amount: "1.231" });
      await expect(insertInfo(db, { amount: "1.234" })).resolves.toBeDefined();
      await expect(insertInfo(db, { amount: "1.231" })).rejects.toThrow(
        /duplicate key value violates unique/,
      );
    });

    test("is not skipped by a table index that has the same name as the member path", async () => {
      const db = await pglite(
        generateSchemaDDL([
          {
            name: "Order",
            fields: {
              id: { type: "uuid" },
              other: { type: "string", required: false },
              info: { type: "nested", fields: { code: { type: "string", unique: true } } },
            },
            indexes: { "info.code": { fields: ["other"], unique: true } },
          },
        ]),
      );

      await insertInfo(db, { code: "dup" });
      await expect(insertInfo(db, { code: "dup" })).rejects.toThrow(
        /duplicate key value violates unique/,
      );
    });

    test("accepts distinct values, and rows that leave the member out", async () => {
      const db = await pglite(generateSchemaDDL([nestedUnique()]));

      await insertInfo(db, { code: "a", seq: 1 });
      await insertInfo(db, { code: "b", seq: 2 });
      await insertInfo(db, { note: "x" });
      await insertInfo(db, { note: "y" });
      await insertInfo(db, { code: null });
      await expect(insertInfo(db, { code: null })).resolves.toBeDefined();
    });

    test("applying the script twice leaves the database unchanged", async () => {
      const script = generateSchemaDDL([nestedUnique()]);
      const db = await pglite(script);

      await expect(db.exec(script)).resolves.toBeDefined();
    });
  });

  test("applying the script twice leaves the database unchanged", async () => {
    const script = generateSchemaDDL([
      {
        name: "A",
        fields: {
          id: { type: "uuid" },
          bID: ref("B", { required: false }),
          ids: ref("B", { array: true, required: false }),
        },
      },
      { name: "B", fields: { id: { type: "uuid" }, aID: ref("A", { required: false }) } },
    ]);
    const db = await pglite(script);
    await expect(db.exec(script)).resolves.toBeDefined();
  });

  test.each([
    ["is not unique", { type: "string" }, { type: "string" }],
    ["has another type", { type: "integer", unique: true }, { type: "string" }],
  ] as const)("a reference to a field that %s is rejected", (_, targetField, sourceField) => {
    expect(() =>
      generateSchemaDDL([
        { name: "Parent", fields: { id: { type: "uuid" }, code: targetField } },
        {
          name: "Child",
          fields: {
            id: { type: "uuid" },
            parentCode: ref("Parent", { ...sourceField, foreignKeyField: "code" }),
          },
        },
      ]),
    ).toThrow(/"Parent"."code", which must be unique and of the same type/);
  });

  test("a reference to id from a field that is not a uuid is rejected", () => {
    expect(() =>
      generateSchemaDDL([
        { name: "Parent", fields: { id: { type: "uuid" } } },
        {
          name: "Child",
          fields: { id: { type: "uuid" }, parentRef: ref("Parent", { type: "string" }) },
        },
      ]),
    ).toThrow(/"Parent"."id", which must be unique and of the same type/);
  });

  test("a reference to a table outside the schema is rejected", () => {
    expect(() =>
      generateSchemaDDL([
        { name: "Child", fields: { id: { type: "uuid" }, parentID: ref("Parent") } },
      ]),
    ).toThrow(/unknown table "Parent"/);
  });
});

describe("foreign keys to a non-id field and edge columns", { timeout: 30_000 }, () => {
  const byCode = (extra: Partial<DDLFieldConfig>): DDLFieldConfig => ({
    type: "string",
    foreignKey: true,
    foreignKeyType: "Parent",
    foreignKeyField: "code",
    ...extra,
  });
  const tables = (child: Record<string, DDLFieldConfig>): DDLTableConfig[] => [
    { name: "Parent", fields: { id: { type: "uuid" }, code: { type: "string", unique: true } } },
    { name: "Child", fields: { id: { type: "uuid" }, ...child } },
  ];

  test("scalar and array references to a unique non-id field are enforced", async () => {
    const db = newPglite();
    await db.exec(generateSchemaDDL(tables({ one: byCode({}), many: byCode({ array: true }) })));
    await db.exec(`INSERT INTO "Parent" (code) VALUES ('a'), ('b')`);
    await db.exec(`INSERT INTO "Child" (one, many) VALUES ('a', '{a,b}')`);
    await expect(db.exec(`INSERT INTO "Child" (one) VALUES ('zzz')`)).rejects.toThrow(
      /foreign key/,
    );
    await expect(db.exec(`INSERT INTO "Child" (many) VALUES ('{a,zzz}')`)).rejects.toThrow(
      /zzz not found in "Parent"."code"/,
    );
  });

  test("a NULL element or NULL column in an array reference is accepted", async () => {
    const db = newPglite();
    await db.exec(generateSchemaDDL(tables({ many: byCode({ array: true }) })));
    await db.exec(`INSERT INTO "Parent" (code) VALUES ('a')`);
    await db.exec(`INSERT INTO "Child" (many) VALUES ('{a,NULL}'), (NULL)`);
    const { rows } = await db.query(`SELECT 1 FROM "Child"`);
    expect(rows).toHaveLength(2);
  });

  test("a reference declared on id leaves the primary key column unchanged", () => {
    const script = generateSchemaDDL(
      tables({}).map((t) =>
        t.name === "Child"
          ? { ...t, fields: { id: { type: "uuid", foreignKey: true, foreignKeyType: "Parent" } } }
          : t,
      ),
    );
    expect(script).toContain('"id" uuid PRIMARY KEY DEFAULT gen_random_uuid()\n');
    expect(script).not.toContain("REFERENCES");
  });
});

describe("dropUnresolvableReferences", () => {
  const parent: DDLTableConfig = { name: "Parent", fields: { id: { type: "uuid" } } };
  const toParent = (extra: Partial<DDLFieldConfig> = {}): DDLFieldConfig => ({
    type: "uuid",
    foreignKey: true,
    foreignKeyType: "Parent",
    ...extra,
  });

  test("keeps references that resolve, including inside nested fields", () => {
    const child: DDLTableConfig = {
      name: "Child",
      fields: {
        id: { type: "uuid" },
        owner: toParent(),
        info: { type: "nested", fields: { owner: toParent() } },
      },
    };
    expect(dropUnresolvableReferences([parent, child])).toEqual([parent, child]);
  });

  test("drops only the references that do not resolve, inside nested fields too", () => {
    const [, child] = dropUnresolvableReferences([
      parent,
      {
        name: "Child",
        fields: {
          id: { type: "uuid" },
          owner: toParent(),
          ghost: toParent({ foreignKeyType: "Ghost" }),
          info: {
            type: "nested",
            fields: { owner: toParent(), ghost: toParent({ foreignKeyType: "Ghost" }) },
          },
        },
      },
    ]);
    expect(child!.fields.owner).toMatchObject({ foreignKey: true });
    expect(child!.fields.ghost).toEqual({ type: "uuid" });
    expect(child!.fields.info!.fields!.owner).toMatchObject({ foreignKey: true });
    expect(child!.fields.info!.fields!.ghost).toEqual({ type: "uuid" });
  });

  test("drops a reference to id from a field that is not a uuid", () => {
    const [, child] = dropUnresolvableReferences([
      parent,
      { name: "Child", fields: { id: { type: "uuid" }, owner: toParent({ type: "string" }) } },
    ]);
    expect(child!.fields.owner).toEqual({ type: "string" });
  });
});

describe("reference triggers", { timeout: 30_000 }, () => {
  test("a referenced table with a column named v does not make the trigger ambiguous", async () => {
    const db = newPglite();
    await db.exec(
      generateSchemaDDL([
        { name: "Parent", fields: { id: { type: "uuid" }, v: { type: "string", unique: true } } },
        {
          name: "Child",
          fields: {
            id: { type: "uuid" },
            ids: { type: "uuid", array: true, foreignKey: true, foreignKeyType: "Parent" },
            byV: {
              type: "string",
              array: true,
              foreignKey: true,
              foreignKeyType: "Parent",
              foreignKeyField: "v",
            },
          },
        },
      ]),
    );
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO "Parent" (v) VALUES ('x') RETURNING id`,
    );
    await db.query(`INSERT INTO "Child" (ids, "byV") VALUES ($1, $2)`, [`{${rows[0]!.id}}`, "{x}"]);
    await expect(db.query(`INSERT INTO "Child" ("byV") VALUES ($1)`, ["{y}"])).rejects.toThrow(
      /y not found in "Parent"."v"/,
    );
  });
});

describe("reference validation and quoting", { timeout: 30_000 }, () => {
  test.each([
    ["an enum field referencing a string field", "enum", "string"],
    ["a string field referencing an enum field", "string", "enum"],
  ] as const)("%s is rejected as a type mismatch", (_, sourceType, targetType) => {
    expect(() =>
      generateSchemaDDL([
        {
          name: "Parent",
          fields: { id: { type: "uuid" }, code: { type: targetType, unique: true } },
        },
        {
          name: "Child",
          fields: {
            id: { type: "uuid" },
            parentCode: {
              type: sourceType,
              foreignKey: true,
              foreignKeyType: "Parent",
              foreignKeyField: "code",
            },
          },
        },
      ]),
    ).toThrow(/must be unique and of the same type/);
  });

  test("a table name that contains the dollar-quote delimiter still yields valid trigger SQL", async () => {
    const db = newPglite();
    await db.exec(
      generateSchemaDDL([
        { name: "Parent$fk$", fields: { id: { type: "uuid" } } },
        {
          name: "Child",
          fields: {
            id: { type: "uuid" },
            ids: { type: "uuid", array: true, foreignKey: true, foreignKeyType: "Parent$fk$" },
          },
        },
      ]),
    );
    await expect(
      db.query(`INSERT INTO "Child" (ids) VALUES ($1)`, [`{${crypto.randomUUID()}}`]),
    ).rejects.toThrow(/not found/);
  });

  test("a table name that contains the dollar-quote delimiter still yields a valid deferred constraint", async () => {
    const db = newPglite();
    await db.exec(
      generateSchemaDDL([
        {
          name: "A$fk$",
          fields: {
            id: { type: "uuid" },
            bID: { type: "uuid", foreignKey: true, foreignKeyType: "B" },
          },
        },
        {
          name: "B",
          fields: {
            id: { type: "uuid" },
            aID: { type: "uuid", foreignKey: true, foreignKeyType: "A$fk$" },
          },
        },
      ]),
    );
    await expect(db.exec(`INSERT INTO "A$fk$" ("bID") VALUES (gen_random_uuid())`)).rejects.toThrow(
      /foreign key/,
    );
  });
});

describe("reference triggers see the rows actually written", { timeout: 30_000 }, () => {
  const parent: DDLTableConfig = {
    name: "Parent",
    fields: { id: { type: "uuid" }, code: { type: "string", unique: true } },
  };
  const child: DDLTableConfig = {
    name: "Child",
    fields: {
      id: { type: "uuid" },
      ids: { type: "uuid", array: true, foreignKey: true, foreignKeyType: "Parent" },
      code: { type: "string", unique: true },
    },
  };

  test("a row discarded by ON CONFLICT DO NOTHING is not checked", async () => {
    const db = newPglite();
    await db.exec(generateSchemaDDL([parent, child]));
    await db.exec(`INSERT INTO "Child" (code) VALUES ('c')`);
    await db.query(
      `INSERT INTO "Child" (code, ids) VALUES ('c', $1) ON CONFLICT (code) DO NOTHING`,
      [`{${crypto.randomUUID()}}`],
    );
    const { rows } = await db.query(`SELECT 1 FROM "Child"`);
    expect(rows).toHaveLength(1);
  });

  test("an array may point at the row being inserted", async () => {
    const db = newPglite();
    await db.exec(
      generateSchemaDDL([
        {
          name: "Node",
          fields: {
            id: { type: "uuid" },
            ids: { type: "uuid", array: true, foreignKey: true, foreignKeyType: "Node" },
          },
        },
      ]),
    );
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO "Node" (id, ids) VALUES ($1, $2)`, [id, `{${id}}`]);
    const { rows } = await db.query(`SELECT 1 FROM "Node"`);
    expect(rows).toHaveLength(1);
  });
});

describe("deleting a parent that an array or nested value points at", { timeout: 30_000 }, () => {
  const parent: DDLTableConfig = {
    name: "Parent",
    fields: { id: { type: "uuid" }, code: { type: "string", unique: true } },
  };
  const reference = (extra: Partial<DDLFieldConfig> = {}): DDLFieldConfig => ({
    type: "uuid",
    foreignKey: true,
    foreignKeyType: "Parent",
    ...extra,
  });
  const child: DDLTableConfig = {
    name: "Child",
    fields: {
      id: { type: "uuid" },
      ids: reference({ array: true }),
      info: { type: "nested", fields: { ownerID: reference() } },
      lines: { type: "nested", array: true, fields: { assigneeID: reference() } },
    },
  };
  const stillReferenced =
    /update or delete on table `Parent` violates foreign key constraint: some record is still referenced from table `Child`/;

  async function setup(tables: DDLTableConfig[] = [parent, child]): Promise<PGlite> {
    const db = newPglite();
    await db.exec(generateSchemaDDL(tables));
    return db;
  }

  async function insertParent(db: PGlite, code = "p"): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO "Parent" (code) VALUES ($1) RETURNING id`,
      [code],
    );
    return rows[0]!.id;
  }

  test.each([
    [
      "an element of an array column",
      `INSERT INTO "Child" (ids) VALUES ($1)`,
      (id: string) => `{${id}}`,
    ],
    [
      "a nested value",
      `INSERT INTO "Child" (info) VALUES ($1::jsonb)`,
      (id: string) => JSON.stringify({ ownerID: id }),
    ],
    [
      "an element of a nested array",
      `INSERT INTO "Child" (lines) VALUES ($1::jsonb)`,
      (id: string, other: string) => JSON.stringify([{ assigneeID: other }, { assigneeID: id }]),
    ],
  ])("refuses to delete a parent that %s points at", async (_, insert, value) => {
    const db = await setup();
    const id = await insertParent(db);
    const other = await insertParent(db, "other");
    await db.query(insert, [value(id, other)]);

    await expect(db.query(`DELETE FROM "Parent" WHERE id = $1`, [id])).rejects.toThrow(
      stillReferenced,
    );
  });

  test("deletes a parent nothing points at, and one whose referencing row was changed", async () => {
    const db = await setup();
    const free = await insertParent(db, "free");
    const held = await insertParent(db, "held");
    await db.query(`INSERT INTO "Child" (ids) VALUES ($1)`, [`{${held}}`]);

    await db.query(`DELETE FROM "Parent" WHERE id = $1`, [free]);
    await db.query(`UPDATE "Child" SET ids = '{}'`);
    await db.query(`DELETE FROM "Parent" WHERE id = $1`, [held]);

    const { rows } = await db.query(`SELECT 1 FROM "Parent"`);
    expect(rows).toHaveLength(0);
  });

  test("a null column, an empty array and a JSON null do not hold a parent", async () => {
    const db = await setup();
    const id = await insertParent(db);
    await db.query(`INSERT INTO "Child" (ids, info, lines) VALUES (NULL, NULL, NULL)`);
    await db.query(`INSERT INTO "Child" (ids, info, lines) VALUES ('{}', $1::jsonb, '[]')`, [
      JSON.stringify({ ownerID: null }),
    ]);

    await db.query(`DELETE FROM "Parent" WHERE id = $1`, [id]);

    const { rows } = await db.query(`SELECT 1 FROM "Parent"`);
    expect(rows).toHaveLength(0);
  });

  test("a nested value written in upper case still holds the parent", async () => {
    const db = await setup();
    const id = await insertParent(db);
    await db.query(`INSERT INTO "Child" (info) VALUES ($1::jsonb)`, [
      JSON.stringify({ ownerID: id.toUpperCase() }),
    ]);

    await expect(db.query(`DELETE FROM "Parent" WHERE id = $1`, [id])).rejects.toThrow(
      stillReferenced,
    );
  });

  test("names the table of whichever child still points at the parent", async () => {
    const other: DDLTableConfig = {
      name: "Other",
      fields: { id: { type: "uuid" }, ids: reference({ array: true }) },
    };
    const db = await setup([parent, child, other]);
    const id = await insertParent(db);
    await db.query(`INSERT INTO "Other" (ids) VALUES ($1)`, [`{${id}}`]);

    await expect(db.query(`DELETE FROM "Parent" WHERE id = $1`, [id])).rejects.toThrow(
      /still referenced from table `Other`/,
    );
  });

  test("follows foreignKeyField when the reference is not to the id", async () => {
    const byCode: DDLTableConfig = {
      name: "ByCode",
      fields: {
        id: { type: "uuid" },
        codes: {
          type: "string",
          array: true,
          foreignKey: true,
          foreignKeyType: "Parent",
          foreignKeyField: "code",
        },
      },
    };
    const db = await setup([parent, byCode]);
    const id = await insertParent(db, "held");
    await db.query(`INSERT INTO "ByCode" (codes) VALUES ('{held}')`);

    await expect(db.query(`DELETE FROM "Parent" WHERE id = $1`, [id])).rejects.toThrow(
      /still referenced from table `ByCode`/,
    );
  });

  describe("a table whose array points at its own rows", () => {
    const node: DDLTableConfig = {
      name: "Node",
      fields: {
        id: { type: "uuid" },
        ids: { type: "uuid", array: true, foreignKey: true, foreignKeyType: "Node" },
      },
    };
    const stillReferencedFromNode =
      /update or delete on table `Node` violates foreign key constraint: some record is still referenced from table `Node`/;

    test("refuses to delete a row that only points at itself", async () => {
      const db = await setup([node]);
      const id = crypto.randomUUID();
      await db.query(`INSERT INTO "Node" (id, ids) VALUES ($1, $2)`, [id, `{${id}}`]);

      await expect(db.query(`DELETE FROM "Node" WHERE id = $1`, [id])).rejects.toThrow(
        stillReferencedFromNode,
      );
    });

    test("refuses to delete in one statement two rows that point at each other", async () => {
      const db = await setup([node]);
      const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
      await db.query(`INSERT INTO "Node" (id) VALUES ($1)`, [second]);
      await db.query(`INSERT INTO "Node" (id, ids) VALUES ($1, $2)`, [first, `{${second}}`]);

      await expect(
        db.query(`DELETE FROM "Node" WHERE id IN ($1, $2)`, [first, second]),
      ).rejects.toThrow(stillReferencedFromNode);
    });

    test("deletes the referencing row first, then the row it pointed at", async () => {
      const db = await setup([node]);
      const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
      await db.query(`INSERT INTO "Node" (id) VALUES ($1)`, [second]);
      await db.query(`INSERT INTO "Node" (id, ids) VALUES ($1, $2)`, [first, `{${second}}`]);

      await db.query(`DELETE FROM "Node" WHERE id = $1`, [first]);
      await db.query(`DELETE FROM "Node" WHERE id = $1`, [second]);

      const { rows } = await db.query(`SELECT 1 FROM "Node"`);
      expect(rows).toHaveLength(0);
    });
  });

  test("a nested value that is not a uuid does not stop deleting a parent", async () => {
    const db = await setup();
    const id = await insertParent(db);
    await db.exec("SET session_replication_role = replica");
    await db.query(`INSERT INTO "Child" (info) VALUES ($1::jsonb)`, [
      JSON.stringify({ ownerID: "legacy-123" }),
    ]);
    await db.exec("SET session_replication_role = origin");

    await db.query(`DELETE FROM "Parent" WHERE id = $1`, [id]);

    const { rows } = await db.query(`SELECT 1 FROM "Parent"`);
    expect(rows).toHaveLength(0);
  });

  test("applying the script again leaves the database unchanged", async () => {
    const db = await setup();
    await expect(db.exec(generateSchemaDDL([parent, child]))).resolves.toBeDefined();
  });

  describe("changing the key a parent is pointed at by", () => {
    const byCode: DDLTableConfig = {
      name: "ByCode",
      fields: {
        id: { type: "uuid" },
        codes: {
          type: "string",
          array: true,
          foreignKey: true,
          foreignKeyType: "Parent",
          foreignKeyField: "code",
        },
      },
    };

    test("refuses to change a key that an array element still points at", async () => {
      const db = await setup([parent, byCode]);
      const id = await insertParent(db, "held");
      await db.query(`INSERT INTO "ByCode" (codes) VALUES ('{held}')`);

      await expect(
        db.query(`UPDATE "Parent" SET code = 'renamed' WHERE id = $1`, [id]),
      ).rejects.toThrow(/still referenced from table `ByCode`/);
    });

    test("refuses to change the id that an array element still points at", async () => {
      const db = await setup();
      const id = await insertParent(db);
      await db.query(`INSERT INTO "Child" (ids) VALUES ($1)`, [`{${id}}`]);

      await expect(
        db.query(`UPDATE "Parent" SET id = $2 WHERE id = $1`, [id, crypto.randomUUID()]),
      ).rejects.toThrow(stillReferenced);
    });

    test("allows changing a column nothing points at, and a key nothing points at", async () => {
      const db = await setup([parent, byCode]);
      const held = await insertParent(db, "held");
      const free = await insertParent(db, "free");
      await db.query(`INSERT INTO "ByCode" (codes) VALUES ('{held}')`);

      await db.query(`UPDATE "Parent" SET code = 'free-renamed' WHERE id = $1`, [free]);
      await db.query(`UPDATE "Parent" SET code = code WHERE id = $1`, [held]);

      const { rows } = await db.query(`SELECT 1 FROM "Parent" WHERE code = 'free-renamed'`);
      expect(rows).toHaveLength(1);
    });
  });
});
