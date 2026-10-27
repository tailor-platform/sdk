import { describe, expect, test } from "vitest";
import { parseSql, type SqlStatement } from "./parser";

function parsed(source: string): SqlStatement {
  const result = parseSql(source);
  expect(result.diagnostics).toEqual([]);
  return result.statement!;
}

function rejection(source: string): { message: string; at: string } {
  const result = parseSql(source);
  expect(result.statement).toBeUndefined();
  expect(result.diagnostics).toHaveLength(1);
  const [diagnostic] = result.diagnostics;
  return {
    message: diagnostic!.message,
    at: source.slice(diagnostic!.start, diagnostic!.start + diagnostic!.length),
  };
}

describe("parseSql", () => {
  describe("select", () => {
    test("keeps the case of unquoted identifiers and unquotes quoted ones", () => {
      const statement = parsed('SELECT name, "Tier", c.customerID FROM Customer c');

      expect(statement).toMatchObject({
        kind: "select",
        items: [
          { expr: { kind: "column", column: { name: "name" } } },
          { expr: { kind: "column", column: { name: "Tier" } } },
          { expr: { kind: "column", table: { name: "c" }, column: { name: "customerID" } } },
        ],
        from: { table: { name: "Customer" }, alias: { name: "c" } },
      });
    });

    test("reads keywords in any case and aliases with or without AS", () => {
      const statement = parsed(
        'select o."id" As orderId from "Order" AS Ord left OUTER join "Customer" cust on Ord."customerID" = cust."id"',
      );

      expect(statement).toMatchObject({
        items: [{ alias: { name: "orderId" } }],
        from: { table: { name: "Order" }, alias: { name: "Ord" } },
        joins: [{ type: "left", table: { table: { name: "Customer" }, alias: { name: "cust" } } }],
      });
    });

    test("parses every documented clause", () => {
      const statement = parsed(
        'SELECT "customerID", count(*) AS n, sum(DISTINCT "amount") FROM "Order" WHERE "status" IN (:a, :b) AND "paid" IS NOT NULL OR "amount" NOT BETWEEN 1 AND :max GROUP BY "customerID" HAVING count(*) >= :min ORDER BY n DESC, "customerID" LIMIT :limit OFFSET 10 FOR UPDATE;',
      );

      expect(statement).toMatchObject({
        kind: "select",
        items: [
          { expr: { kind: "column" } },
          { expr: { kind: "aggregate", fn: "count", arg: undefined }, alias: { name: "n" } },
          { expr: { kind: "aggregate", fn: "sum", distinct: true } },
        ],
        where: { kind: "or", left: { kind: "and" } },
        groupBy: [{ column: { name: "customerID" } }],
        having: { kind: "compare", op: ">=", left: { kind: "aggregate" } },
        orderBy: [{ desc: true }, { desc: false }],
        limit: { kind: "param", name: "limit" },
        offset: { kind: "literal", value: "10" },
      });
    });

    test("parses arithmetic with precedence, parentheses and unary minus", () => {
      expect(
        parsed('SELECT "a" + "b" * 2 AS x, -("a" - 1) / 2, 1.5, -1, \'s\', true FROM "T"'),
      ).toMatchObject({
        items: [
          {
            expr: {
              kind: "arithmetic",
              op: "+",
              left: { kind: "column", column: { name: "a" } },
              right: {
                kind: "arithmetic",
                op: "*",
                left: { kind: "column" },
                right: { kind: "literal", value: "2" },
              },
            },
            alias: { name: "x" },
          },
          {
            expr: {
              kind: "arithmetic",
              op: "/",
              left: { kind: "negation", operand: { kind: "arithmetic", op: "-" } },
            },
          },
          { expr: { kind: "literal", type: "number", value: "1.5" } },
          { expr: { kind: "literal", type: "number", value: "-1" } },
          { expr: { kind: "literal", type: "string", value: "s" } },
          { expr: { kind: "literal", type: "boolean", value: "true" } },
        ],
      });
    });

    test("parses arithmetic in conditions and aggregates", () => {
      expect(
        parsed(
          'SELECT sum("a" * 2) FROM "T" WHERE "a" + :d > "b" - 1 AND ("a" + 1) * 2 IN (1, 2) AND ("a") = :a GROUP BY "c" HAVING sum("a") + 1 > :n',
        ),
      ).toMatchObject({
        items: [{ expr: { kind: "aggregate", fn: "sum", arg: { kind: "arithmetic", op: "*" } } }],
        where: {
          kind: "and",
          left: {
            kind: "and",
            left: {
              kind: "compare",
              left: { kind: "arithmetic", right: { kind: "param", name: "d" } },
              right: { kind: "arithmetic", op: "-" },
            },
            right: { kind: "in", left: { kind: "arithmetic", op: "*" } },
          },
          right: { kind: "compare", left: { kind: "column" }, right: { kind: "param" } },
        },
        having: { kind: "compare", left: { kind: "arithmetic", left: { kind: "aggregate" } } },
      });
    });

    test("tells *, a qualified * and count(*) from multiplication", () => {
      expect(
        parsed('SELECT *, t.*, "a" * 2 AS x FROM "T" t GROUP BY "a" HAVING count(*) * 2 > 1'),
      ).toMatchObject({
        items: [
          { expr: { kind: "star" } },
          { expr: { kind: "star", table: { name: "t" } } },
          { expr: { kind: "arithmetic", op: "*" } },
        ],
        having: { left: { kind: "arithmetic", left: { kind: "aggregate", arg: undefined } } },
      });
    });

    test("tells a parenthesized condition from a parenthesized expression", () => {
      expect(parsed('SELECT "a" FROM "T" WHERE (("a" = 1) OR "b" = 2)')).toMatchObject({
        where: { kind: "or", left: { kind: "compare" } },
      });
      expect(parsed('SELECT "a" FROM "T" WHERE (("a" + 1) * 2) >= 3')).toMatchObject({
        where: { kind: "compare", left: { kind: "arithmetic", op: "*" } },
      });
    });

    test("parses vector_similarity in ORDER BY", () => {
      expect(
        parsed('SELECT "id" FROM "Product" ORDER BY vector_similarity("description", :q) DESC'),
      ).toMatchObject({
        orderBy: [{ by: { kind: "vector", column: { column: { name: "description" } } } }],
      });
    });
  });

  describe("writes", () => {
    test("parses INSERT with several rows, DEFAULT, ON CONFLICT and RETURNING", () => {
      expect(
        parsed(
          'INSERT INTO "Customer" ("name", "tier") VALUES (:name, DEFAULT), (\'Bob\', \'PRO\') ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name", "tier" = :tier RETURNING *',
        ),
      ).toMatchObject({
        kind: "insert",
        table: { name: "Customer" },
        columns: [{ name: "name" }, { name: "tier" }],
        rows: [
          { values: [{ kind: "param", name: "name" }, { kind: "default" }] },
          { values: [{}, {}] },
        ],
        onConflict: {
          column: { name: "email" },
          action: {
            kind: "update",
            sets: [{ value: { kind: "excluded" } }, { value: { kind: "param" } }],
          },
        },
        returning: [{ expr: { kind: "star" } }],
      });
    });

    test("parses INSERT DEFAULT VALUES and ON CONFLICT DO NOTHING", () => {
      expect(
        parsed('insert into "Event" default values on conflict ("id") do nothing'),
      ).toMatchObject({ rows: "default", onConflict: { action: { kind: "nothing" } } });
    });

    test("parses UPDATE with arithmetic and DELETE with RETURNING", () => {
      expect(
        parsed('UPDATE "Order" SET "amount" = "amount" + :delta WHERE "id" = :id RETURNING "id"'),
      ).toMatchObject({
        kind: "update",
        sets: [{ column: { name: "amount" }, value: { kind: "arithmetic", op: "+" } }],
        returning: [{}],
      });
      expect(parsed('DELETE FROM "Order" WHERE "id" = :id')).toMatchObject({
        kind: "delete",
        returning: undefined,
      });
    });
  });

  describe("placeholders", () => {
    test("numbers each occurrence and skips strings, quoted identifiers and comments", () => {
      const source = [
        "-- :ignored in a comment",
        "/* and :here */",
        `SELECT "a:b" FROM "T" WHERE "x" = ':no' AND "y" = :yes AND "z" = :yes`,
      ].join("\n");

      expect(parseSql(source)).toMatchObject({
        diagnostics: [],
        text: `SELECT "a:b" FROM "T" WHERE "x" = ':no' AND "y" = $1 AND "z" = $2`,
        paramNames: ["yes", "yes"],
      });
    });

    test("sends the statement without leading comments, a BOM or a trailing semicolon", () => {
      expect(parseSql('\uFEFF-- get orders\nselect "id" from "Order";\n')).toMatchObject({
        text: 'select "id" from "Order"',
      });
    });
  });

  describe("rejections", () => {
    test.each([
      { source: 'SELECT "id" FROM "T" WHERE "id" = :id::uuid', message: /casts/i, at: "::" },
      { source: 'SELECT "id" FROM "T" WHERE "id" = $1', message: /:name/, at: "$1" },
      {
        source: 'SELECT coalesce("a", 0) FROM "T"',
        message: /coalesce/,
        at: "coalesce",
      },
      { source: 'SELECT DISTINCT "a" FROM "T"', message: /DISTINCT/, at: "DISTINCT" },
      { source: 'WITH x AS (SELECT 1) SELECT "a" FROM x', message: /WITH/, at: "WITH" },
      {
        source: 'SELECT "a" FROM "T" WHERE "a" IN (SELECT "b" FROM "U")',
        message: /subquer/i,
        at: "SELECT",
      },
      {
        source: 'SELECT "a" FROM "T" ORDER BY "a" NULLS FIRST',
        message: /NULLS/,
        at: "NULLS",
      },
      { source: 'SELECT "a" % 2 FROM "T"', message: /%/, at: "%" },
      { source: 'SELECT :a FROM "T"', message: /placeholder/i, at: ":a" },
      { source: 'SELECT "a" + :a FROM "T"', message: /placeholder/i, at: ":a" },
      { source: 'SELECT NULL AS "x" FROM "T"', message: /NULL/, at: "NULL" },
      { source: 'SELECT "a" + NULL AS "x" FROM "T"', message: /NULL/, at: "NULL" },
      { source: 'SELECT sum("a") + 1 FROM "T"', message: /HAVING/, at: "+" },
      { source: 'SELECT 1 + count(*) FROM "T"', message: /HAVING/, at: "count" },
      { source: 'SELECT sum(:a) FROM "T"', message: /placeholder/i, at: ":a" },
      { source: 'SELECT sum(max("a")) FROM "T"', message: /nested/i, at: "max" },
      { source: 'SELECT sum(NULL) FROM "T"', message: /NULL/, at: "NULL" },
      { source: 'SELECT max(1) FROM "T"', message: /MAX/, at: "1" },
      { source: 'SELECT (sum("a")) AS s FROM "T"', message: /alone/, at: "sum" },
      { source: 'SELECT 1e5 FROM "T"', message: /1e5/, at: "1e5" },
      { source: 'SELECT "a" FROM "T" WHERE "a" > 0x10', message: /0x10/, at: "0x10" },
      {
        source: 'SELECT FROM "T"',
        message: /^Unexpected FROM; expected a column, an aggregate or a literal$/,
        at: "FROM",
      },
      {
        source: 'SELECT "a" FROM "T" WHERE = 1',
        message: /^Unexpected "="; expected a column$/,
        at: "=",
      },
      { source: 'SELECT "a" FROM "T" ORDER BY "a" + 1', message: /AS/, at: "+" },
      { source: 'SELECT "a" FROM "T" WHERE NOT ("a" = 1)', message: /NOT/, at: "NOT" },
      { source: 'SELECT "a" FROM "T" WHERE "a" = ANY(:ids)', message: /ANY/, at: "ANY" },
      { source: 'SELECT "a" FROM "T" WHERE :x = "a"', message: /left/i, at: ":x" },
      { source: 'SELECT "a" FROM "T" WHERE ("a" != 1)', message: /!=/, at: "!=" },
      { source: 'SELECT "a" FROM "T" WHERE "a" + 1 LIKE :p', message: /LIKE/, at: '"a" + 1' },
      {
        source:
          'INSERT INTO "T" ("id", "a") VALUES (:id, 1) ON CONFLICT ("id") DO UPDATE SET "a" = EXCLUDED."a" WHERE "a" > 0',
        message: /WHERE/,
        at: "WHERE",
      },
      { source: "BEGIN", message: /transaction/i, at: "BEGIN" },
      {
        source: 'SELECT "a" FROM "T"; SELECT "b" FROM "U"',
        message: /one statement/,
        at: "SELECT",
      },
      { source: "  -- nothing\n", message: /no statement/i, at: "" },
      { source: 'SELECT "a" FROM "T" WHERE "a" = \'open', message: /unterminated/i, at: "'open" },
      { source: 'SELECT "a" FROM "T" WHERE "a" != 1', message: /!=/, at: "!=" },
    ])("$source", ({ source, message, at }) => {
      const result = rejection(source);

      expect(result.message).toMatch(message);
      expect(result.at).toBe(at);
    });

    test("reports a NOT before the column, which TailorDB does not document", () => {
      expect(rejection('SELECT "a" FROM "T" WHERE NOT "b" BETWEEN 1 AND 2').at).toBe("NOT");
    });
  });
});
