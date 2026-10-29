import { describe, expect, test } from "vitest";
import { parseSql, type SqlStatement } from "./parser";

function parsed(source: string): SqlStatement {
  const result = parseSql(source);
  expect(result.diagnostics).toEqual([]);
  return result.statement!;
}

function where(condition: string) {
  const statement = parsed(`SELECT "a" FROM "T" WHERE ${condition}`);
  return statement.kind === "select" ? statement.where : undefined;
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
      expect(parsed('SELECT name, "Tier", c.customerID FROM Customer c')).toMatchObject({
        kind: "select",
        items: [
          { expr: { kind: "column", column: { name: "name", quoted: false } } },
          { expr: { kind: "column", column: { name: "Tier", quoted: true } } },
          { expr: { kind: "column", table: { name: "c" }, column: { name: "customerID" } } },
        ],
        from: { table: { name: "Customer" }, alias: { name: "c" } },
      });
    });

    test("reads keywords in any case, and table aliases with or without AS", () => {
      expect(
        parsed(
          'select o."id" As orderId from "Order" AS Ord left OUTER join "Customer" cust on Ord."customerID" = cust."id"',
        ),
      ).toMatchObject({
        items: [{ alias: { name: "orderId" } }],
        from: { table: { name: "Order" }, alias: { name: "Ord" } },
        joins: [{ type: "left", table: { table: { name: "Customer" }, alias: { name: "cust" } } }],
      });
    });

    test("takes keywords as names where a name is expected", () => {
      expect(parsed("SELECT order AS select FROM from WHERE order = 1")).toMatchObject({
        items: [{ expr: { column: { name: "order" } }, alias: { name: "select" } }],
        from: { table: { name: "from" } },
        where: { kind: "binary", left: { kind: "column", column: { name: "order" } } },
      });
    });

    test("parses every clause", () => {
      expect(
        parsed(
          'SELECT "customerID", count(*) AS n, sum(DISTINCT "amount") FROM "Order" WHERE "status" IN (:a, :b) AND "paid" IS NOT NULL OR "amount" NOT BETWEEN 1 AND :max GROUP BY "customerID" HAVING count(*) >= :min ORDER BY n DESC, "customerID" LIMIT :limit OFFSET 10 FOR NO KEY UPDATE SKIP LOCKED FOR SHARE;',
        ),
      ).toMatchObject({
        kind: "select",
        items: [
          { expr: { kind: "column" } },
          { expr: { kind: "aggregate", fn: "count", arg: undefined }, alias: { name: "n" } },
          { expr: { kind: "aggregate", fn: "sum", distinct: true } },
        ],
        where: { kind: "binary", op: "OR", left: { kind: "binary", op: "AND" } },
        groupBy: [{ column: { name: "customerID" } }],
        having: { kind: "binary", op: ">=", left: { kind: "aggregate" } },
        orderBy: [{ desc: true }, { desc: false }],
        limit: { kind: "param", name: "limit" },
        offset: { kind: "literal", value: "10" },
        locks: [{}, {}],
      });
    });

    test("parses joins of every kind", () => {
      expect(
        parsed(
          'SELECT "a" FROM "T" CROSS JOIN "U" INNER JOIN "V" ON TRUE RIGHT JOIN "W" ON TRUE FULL OUTER JOIN "X" ON TRUE',
        ),
      ).toMatchObject({
        joins: [{ type: "cross" }, { type: "inner" }, { type: "right" }, { type: "full" }],
      });
    });

    test("parses vector_similarity in ORDER BY", () => {
      expect(
        parsed('SELECT "id" FROM "Product" ORDER BY vector_similarity("description", :q) DESC'),
      ).toMatchObject({
        orderBy: [{ by: { kind: "vector", column: { column: { name: "description" } } } }],
      });
    });

    test("parses select-list arithmetic with precedence, parentheses and unary signs", () => {
      expect(
        parsed('SELECT "a" + "b" * 2 AS x, -("a" - 1) / 2 AS y, +1 AS z FROM "T"'),
      ).toMatchObject({
        items: [
          {
            expr: {
              kind: "binary",
              op: "+",
              left: { kind: "column" },
              right: { kind: "binary", op: "*", right: { kind: "literal", value: "2" } },
            },
          },
          {
            expr: {
              kind: "binary",
              op: "/",
              left: { kind: "unary", op: "-", operand: { kind: "binary", op: "-" } },
            },
          },
          { expr: { kind: "unary", op: "+", operand: { kind: "literal", value: "1" } } },
        ],
      });
    });

    test("parses literals and aggregates of expressions in the select list", () => {
      expect(
        parsed(
          'SELECT 1.5 AS a, 1e3 AS b, 5. AS c, \'x\' AS d, true AS e, sum("a" * 2) AS f FROM "T"',
        ),
      ).toMatchObject({
        items: [
          { expr: { kind: "literal", type: "number", value: "1.5" } },
          { expr: { kind: "literal", type: "number", value: "1e3" } },
          { expr: { kind: "literal", type: "number", value: "5." } },
          { expr: { kind: "literal", type: "string", value: "x" } },
          { expr: { kind: "literal", type: "boolean", value: "true" } },
          { expr: { kind: "aggregate", arg: { kind: "binary", op: "*" } } },
        ],
      });
    });

    test("tells *, a qualified * and count(*) from multiplication", () => {
      expect(
        parsed('SELECT *, t.*, "a" * 2 AS x FROM "T" t GROUP BY "a" HAVING count(*) * 2 > 1'),
      ).toMatchObject({
        items: [
          { expr: { kind: "star" } },
          { expr: { kind: "star", table: { name: "t" } } },
          { expr: { kind: "binary", op: "*" } },
        ],
        having: { left: { kind: "binary", left: { kind: "aggregate", arg: undefined } } },
      });
    });
  });

  describe("conditions", () => {
    test("binds NOT below comparisons and above AND", () => {
      expect(where('NOT "a" = 1 AND "b"')).toMatchObject({
        kind: "binary",
        op: "AND",
        left: { kind: "unary", op: "NOT", operand: { kind: "binary", op: "=" } },
        right: { kind: "column", column: { name: "b" } },
      });
    });

    test("reads != as <> and the ~~ operators as LIKE", () => {
      expect(where('"a" != 1 AND "b" ~~ :p AND "c" !~~* :q AND "d" ~* :r')).toMatchObject({
        left: {
          left: { left: { op: "<>" }, right: { op: "LIKE" } },
          right: { op: "NOT ILIKE" },
        },
        right: { op: "~*" },
      });
    });

    test("takes expressions on either side and in IN and BETWEEN", () => {
      expect(
        where('10 < "a" + :d AND ("a" + 1) * 2 IN (1, "b" - 1) AND "a" NOT BETWEEN :x - 1 AND 3'),
      ).toMatchObject({
        left: {
          left: {
            op: "<",
            left: { kind: "literal" },
            right: { kind: "binary", op: "+", right: { kind: "param", name: "d" } },
          },
          right: { kind: "in", left: { op: "*" }, items: [{ kind: "literal" }, { op: "-" }] },
        },
        right: { kind: "between", not: true, low: { op: "-" }, high: { kind: "literal" } },
      });
    });

    test("tells a parenthesized condition from a parenthesized expression", () => {
      expect(where('(("a" = 1) OR "b" = 2)')).toMatchObject({
        kind: "binary",
        op: "OR",
        left: { op: "=" },
      });
      expect(where('(("a" + 1) * 2) >= 3')).toMatchObject({
        op: ">=",
        left: { kind: "binary", op: "*" },
      });
    });

    test("chains comparisons and IS NULL tests left to right", () => {
      expect(where('"a" = 1 = TRUE AND "b" IS NOT NULL IS NULL')).toMatchObject({
        left: { op: "=", left: { op: "=" }, right: { kind: "literal", type: "boolean" } },
        right: { kind: "isNull", not: false, left: { kind: "isNull", not: true } },
      });
    });

    test("reads a minus before a number as a unary operator", () => {
      expect(where('"a" = -1')).toMatchObject({
        right: { kind: "unary", op: "-", operand: { kind: "literal", value: "1" } },
      });
    });
  });

  describe("writes", () => {
    test("parses INSERT with several rows, DEFAULT, arrays, ON CONFLICT and RETURNING", () => {
      expect(
        parsed(
          'INSERT INTO "Customer" ("name", "tier", "tags") VALUES (:name, DEFAULT, ARRAY[\'a\', \'b\']), (\'Bob\', \'PRO\', ARRAY[]) ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name", "note" = "excluded"."note", "tier" = :tier RETURNING *',
        ),
      ).toMatchObject({
        kind: "insert",
        table: { name: "Customer" },
        columns: [{ name: "name" }, { name: "tier" }, { name: "tags" }],
        rows: [
          {
            values: [
              { kind: "param", name: "name" },
              { kind: "default" },
              { kind: "array", items: [{ value: "a" }, { value: "b" }] },
            ],
          },
          { values: [{}, {}, { kind: "array", items: [] }] },
        ],
        onConflict: {
          column: { name: "email" },
          action: {
            kind: "update",
            sets: [
              { value: { kind: "excluded" } },
              { value: { kind: "excluded" } },
              { value: { kind: "param" } },
            ],
          },
        },
        returning: [{ expr: { kind: "star" } }],
      });
    });

    test("folds a sign into a number written as a value", () => {
      expect(parsed('INSERT INTO "T" ("a", "b") VALUES (-1, +2.5)')).toMatchObject({
        rows: [{ values: [{ value: "-1" }, { value: "2.5" }] }],
      });
    });

    test("parses INSERT DEFAULT VALUES and ON CONFLICT DO NOTHING", () => {
      expect(
        parsed('insert into "Event" default values on conflict ("id") do nothing'),
      ).toMatchObject({ rows: "default", onConflict: { action: { kind: "nothing" } } });
    });

    test("parses UPDATE with arithmetic and DELETE with RETURNING", () => {
      expect(
        parsed(
          'UPDATE "Order" SET "amount" = "amount" + :delta, "weight" = -1.5 WHERE "id" = :id RETURNING "id"',
        ),
      ).toMatchObject({
        kind: "update",
        sets: [
          {
            column: { name: "amount" },
            value: {
              kind: "arithmetic",
              op: "+",
              left: { kind: "column" },
              right: { kind: "param" },
            },
          },
          { value: { kind: "literal", value: "-1.5" } },
        ],
        returning: [{}],
      });
      expect(parsed('DELETE FROM "Order" WHERE "id" = :id')).toMatchObject({
        kind: "delete",
        returning: undefined,
      });
    });
  });

  describe("tokens", () => {
    test("numbers each placeholder and skips strings, quoted identifiers and comments", () => {
      const source = [
        "-- :ignored in a comment",
        "/* and :here /* nested :too */ */",
        `SELECT "a:b" FROM "T" WHERE "x" = ':no' AND "y" = :yes AND "z" = :yes`,
      ].join("\n");

      expect(parseSql(source)).toMatchObject({
        diagnostics: [],
        text: `SELECT "a:b" FROM "T" WHERE "x" = ':no' AND "y" = $1 AND "z" = $2`,
        paramNames: ["yes", "yes"],
      });
    });

    test("locates each placeholder by its number", () => {
      const source = 'SELECT "id" FROM "T" WHERE "a" = :a AND "b" IN (:b, :a)';
      const result = parseSql(source);

      expect(result.paramSpans?.map((span) => source.slice(span.start, span.end))).toEqual([
        ":a",
        ":b",
        ":a",
      ]);
      expect(result.paramSpans?.[2]?.start).toBe(source.lastIndexOf(":a"));
    });

    test("sends the statement without leading comments, a BOM or semicolons", () => {
      expect(parseSql('﻿;-- get orders\nselect "id" from "Order";;\n')).toMatchObject({
        text: 'select "id" from "Order"',
      });
    });

    test("ends a line comment at a carriage return", () => {
      expect(rejection('SELECT "a" FROM "T" WHERE "a" = 1 -- c\r"b" = 2').at).toBe('"b"');
    });

    test("reads a number's L suffix, and a name right after a number as its own token", () => {
      expect(parsed('SELECT "a" FROM "T" WHERE "a" = 10L')).toMatchObject({
        where: { right: { kind: "literal", value: "10" } },
      });
      expect(rejection('SELECT "a" FROM "T" WHERE "a" = 1abc').at).toBe("abc");
    });

    test("reads a non-ASCII space as part of a name, as TailorDB does", () => {
      expect(parsed('SELECT a b FROM "T"')).toMatchObject({
        items: [{ expr: { column: { name: "a b" } } }],
      });
    });
  });

  describe("rejections", () => {
    const transaction =
      "Transaction statements are not supported in a .sql file; run the query on a transaction instead";

    test.each([
      { source: 'SELECT "id" FROM "T" WHERE "id" = :id::uuid', message: "found: ::", at: "::" },
      { source: 'SELECT "id" FROM "T" WHERE "id" = $1', message: ":name", at: "$1" },
      { source: 'SELECT coalesce("a", 0) FROM "T"', message: "expected: FROM, found: (", at: "(" },
      { source: 'SELECT DISTINCT "a" FROM "T"', message: 'expected: FROM, found: "a"', at: '"a"' },
      { source: 'SELECT "a" b FROM "T"', message: "expected: FROM, found: b", at: "b" },
      { source: 'SELECT count(*) n FROM "T"', message: "expected: FROM, found: n", at: "n" },
      {
        source: 'WITH x AS (SELECT 1) SELECT "a" FROM x',
        message: "expected: SQL statement, found: WITH",
        at: "WITH",
      },
      {
        source: 'SELECT "a" FROM "T" WHERE "a" IN (SELECT "b" FROM "U")',
        message: 'expected: RParen, found: "b"',
        at: '"b"',
      },
      {
        source: 'SELECT "a" FROM "T" ORDER BY "a" NULLS FIRST',
        message: "found: NULLS",
        at: "NULLS",
      },
      { source: 'SELECT "a" % 2 FROM "T"', message: "expected: FROM, found: %", at: "%" },
      { source: 'SELECT "a" FROM "T" WHERE "a">-1', message: "found: >-", at: ">-" },
      { source: 'SELECT "a" FROM "T" WHERE "a"<>-1', message: "found: <>-", at: "<>-" },
      { source: 'SELECT "a" FROM "T" WHERE "a" || \'x\' = :p', message: "found: ||", at: "||" },
      { source: 'SELECT sum("a") + 1 FROM "T"', message: "expected: FROM, found: +", at: "+" },
      { source: 'SELECT 1 + count(*) FROM "T"', message: "expected: FROM, found: (", at: "(" },
      { source: 'SELECT sum(max("a")) FROM "T"', message: "expected: RParen, found: (", at: "(" },
      { source: 'SELECT count(DISTINCT *) FROM "T"', message: "DISTINCT not allowed", at: "*" },
      { source: 'SELECT "a" FROM "T" ORDER BY "a" + 1', message: "found: +", at: "+" },
      {
        source: 'SELECT "a" FROM "T" ORDER BY VECTOR_SIMILARITY("a", :q)',
        message: "expected: vector function",
        at: "VECTOR_SIMILARITY",
      },
      { source: 'SELECT "a" FROM "T" WHERE "a" = ANY(:ids)', message: "found: (", at: "(" },
      {
        source: 'SELECT "a" FROM "T" WHERE "a" = 0x1F',
        message: "expected: expression",
        at: "0x1F",
      },
      { source: 'SELECT "a" FROM "T", "U"', message: "found: ,", at: "," },
      { source: 'SELECT "a" FROM s."T"', message: "found: .", at: "." },
      {
        source:
          'INSERT INTO "T" ("id", "a") VALUES (:id, 1) ON CONFLICT ("id") DO UPDATE SET "a" = EXCLUDED."a" WHERE "a" > 0',
        message: "found: WHERE",
        at: "WHERE",
      },
      {
        source: 'INSERT INTO "T" ("a") VALUES (1 + 1)',
        message: "expected: RParen, found: +",
        at: "+",
      },
      { source: "BEGIN", message: transaction, at: "BEGIN" },
      { source: "START TRANSACTION", message: transaction, at: "START TRANSACTION" },
      { source: "COMMIT;", message: transaction, at: "COMMIT" },
      { source: "ROLLBACK", message: transaction, at: "ROLLBACK" },
      {
        source: 'SELECT "a" FROM "T"; SELECT "b" FROM "U"',
        message: "one statement",
        at: "SELECT",
      },
      {
        source: 'SELECT "a" FROM "T" UNION SELECT "b" FROM "U"',
        message: "found: SELECT",
        at: "SELECT",
      },
      { source: "  -- nothing\n;", message: "no statement", at: "" },
    ])("$source", ({ source, message, at }) => {
      const result = rejection(source);

      expect(result.message).toContain(message);
      expect(result.at).toBe(at);
    });

    test("points an unterminated string at its quote and an unterminated comment at the end", () => {
      const string = 'SELECT "a" FROM "T" WHERE "a" = \'open';
      const comment = 'SELECT "a" FROM "T" /* open';

      expect(parseSql(string).diagnostics).toEqual([
        { message: "Unterminated string literal", start: string.indexOf("'"), length: 0 },
      ]);
      expect(parseSql(comment).diagnostics).toEqual([
        {
          message: "Unexpected EOF while in a multi-line comment",
          start: comment.length,
          length: 0,
        },
      ]);
    });

    test("reports a condition nested too deeply and parses the next query", () => {
      const nested = `SELECT "a" FROM "T" WHERE ${"(".repeat(10_000)}"a" = 1${")".repeat(10_000)}`;

      expect(parseSql(nested).diagnostics).toHaveLength(1);
      expect(parsed('SELECT "a" FROM "T"')).toMatchObject({ kind: "select" });
    });
  });
});
