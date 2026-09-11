import { describe, expect, test } from "vitest";
import {
  generateSchemaDDL,
  generateTableDDL,
  mapFieldTypeToPostgresType,
  type DDLFieldConfig,
  type DDLTableConfig,
} from "./tailordb-ddl";

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

    test("rejects a default that cannot be rendered", () => {
      expect(() =>
        columnLine({ n: { type: "integer", required: true, default: NaN } }, "n"),
      ).toThrow(/"n"/);
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
      expect(sequence).toBe('CREATE SEQUENCE IF NOT EXISTS "Item_n_seq" START WITH 0 MINVALUE 0');
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
        'CREATE SEQUENCE IF NOT EXISTS "Item_invoiceNumber_seq" START WITH 1000 MINVALUE 1000 MAXVALUE 99999',
      );
      expect(statements[1]).toContain(
        "\"invoiceNumber\" text NOT NULL DEFAULT ('INV-' || translate(format('%5s', nextval('\"Item_invoiceNumber_seq\"')), ' ', '0'))",
      );
    });

    test("string serial formats: plain %d, space-padded width, suffix text, and a quote in the text", () => {
      expect(columnLine({ n: { type: "string", serial: { start: 1, format: "%d" } } }, "n")).toBe(
        '"n" text DEFAULT (nextval(\'"Item_n_seq"\')::text)',
      );
      expect(columnLine({ n: { type: "string", serial: { start: 1, format: "%3d" } } }, "n")).toBe(
        "\"n\" text DEFAULT (format('%3s', nextval('\"Item_n_seq\"')))",
      );
      expect(columnLine({ n: { type: "string", serial: { start: 1, format: "A%dB" } } }, "n")).toBe(
        "\"n\" text DEFAULT ('A' || nextval('\"Item_n_seq\"')::text || 'B')",
      );
      expect(
        columnLine({ n: { type: "string", serial: { start: 1, format: "it's-%d" } } }, "n"),
      ).toBe("\"n\" text DEFAULT ('it''s-' || nextval('\"Item_n_seq\"')::text)");
    });

    test("a unique string serial keeps its UNIQUE constraint", () => {
      expect(
        columnLine(
          { n: { type: "string", required: true, unique: true, serial: { start: 1 } } },
          "n",
        ),
      ).toBe('"n" text NOT NULL UNIQUE DEFAULT (nextval(\'"Item_n_seq"\')::text)');
    });

    test("string serial without a format is the bare sequence value", () => {
      expect(columnLine({ n: { type: "string", serial: { start: 1 } } }, "n")).toBe(
        '"n" text DEFAULT (nextval(\'"Item_n_seq"\')::text)',
      );
    });

    test("rejects serial formats it cannot reproduce", () => {
      for (const format of ["%x", "%o", "%X", "%d-%d", "no-specifier", "%s"]) {
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
      'CREATE UNIQUE INDEX IF NOT EXISTS "Item_idx_a_b" ON "Item" ("a", "b")',
    );
  });

  test("identifiers are double-quoted with embedded quotes doubled", () => {
    const [create] = generateTableDDL({
      name: 'We"ird',
      fields: { id: { type: "uuid" }, 'co"l': { type: "string" } },
    });
    expect(create).toContain('CREATE TABLE IF NOT EXISTS "We""ird" (');
    expect(create).toContain('"co""l" text');
  });

  test("rejects identifiers longer than Postgres allows", () => {
    const long = "x".repeat(64);
    expect(() => generateTableDDL({ name: long, fields: { id: { type: "uuid" } } })).toThrow(/63/);
    expect(() => generateTableDDL(table({ [long]: { type: "string" } }))).toThrow(/63/);
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
        'CREATE SEQUENCE IF NOT EXISTS "A_n_seq" START WITH 1 MINVALUE 1;',
        'CREATE TABLE IF NOT EXISTS "A" (',
        '  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  "n" text DEFAULT (nextval(\'"A_n_seq"\')::text)',
        ");",
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
