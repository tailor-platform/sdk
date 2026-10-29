import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/index";
import { toSchemaOutput } from "#/utils/test/internal";
import { analyzeSql, serializeSqlDefinitions, type SqlDefinitions } from "./analyze";
import type { TailorAnyDBType } from "#/configure/services/tailordb/types";

const customer = db.table("Customer", {
  name: db.string(),
  email: db.string().unique(),
  tier: db.enum(["FREE", "PRO"]),
  note: db.string({ optional: true }),
  nickname: db.string({ optional: true }).hooks({ update: ({ input }) => input }),
  ...db.fields.timestamps(),
});

const order = db
  .table("Order", {
    customerID: db.uuid().relation({ type: "n-1", toward: { table: customer } }),
    status: db.enum(["PENDING", "PAID", "CANCELLED"]),
    priority: db.enum(["LOW", "HIGH"], { optional: true }),
    amount: db.int(),
    weight: db.float({ optional: true }),
    total: db.decimal({ scale: 2 }),
    paid: db.bool(),
    orderDate: db.date(),
    paidAt: db.datetime({ optional: true }),
    deliveryTime: db.time({ optional: true }),
    tags: db.string({ optional: true, array: true }),
    shipping: db.object({
      city: db.string(),
      zip: db.string({ optional: true }),
      window: db.time({ optional: true }),
    }),
    lines: db.object({ sku: db.string(), qty: db.int() }, { array: true, optional: true }),
  })
  .indexes({ fields: ["customerID", "orderDate"], unique: true });

const product = db.table("Product", {
  name: db.string(),
  description: db.string().vector(),
  active: db.bool({ optional: true }),
  code: db.int({ optional: true }).unique(),
});

const ledger = db
  .table("Ledger", { balance: db.int(), memo: db.string({ optional: true }) })
  .hooks({ update: () => ({}) });

const event = db.table("Event", { name: db.string() });

function namespace(...types: TailorAnyDBType[]) {
  const parsed = parseTypes(
    Object.fromEntries(types.map((type) => [type.name, toSchemaOutput(type)])),
    "test",
    {},
  );
  return Object.values(parsed);
}

function definitions(temporal = false): SqlDefinitions {
  return {
    namespaces: new Map([
      ["main", namespace(customer, order, product, ledger)],
      ["other", namespace(event)],
    ]),
    temporal,
  };
}

function analyzed(source: string, temporal = false) {
  const result = analyzeSql(source, definitions(temporal));
  expect(result.diagnostics).toEqual([]);
  return result.analysis!;
}

function rejected(source: string) {
  const result = analyzeSql(source, definitions());
  expect(result.analysis).toBeUndefined();
  return result.diagnostics.map((d) => ({
    message: d.message,
    at: source.slice(d.start, d.start + d.length),
  }));
}

describe("analyzeSql", () => {
  describe("row types", () => {
    test("maps every field type as tailordb.Client returns it", () => {
      const analysis = analyzed('SELECT * FROM "Order"');

      expect(analysis.namespace).toBe("main");
      expect(analysis.columns).toEqual([
        { name: "id", type: "string" },
        { name: "customerID", type: "string" },
        { name: "status", type: '"PENDING" | "PAID" | "CANCELLED"' },
        { name: "priority", type: '"LOW" | "HIGH" | null' },
        { name: "amount", type: "number" },
        { name: "weight", type: "number | null" },
        { name: "total", type: "string" },
        { name: "paid", type: "boolean" },
        { name: "orderDate", type: "Date" },
        { name: "paidAt", type: "Date | null" },
        { name: "deliveryTime", type: "string | null" },
        { name: "tags", type: "string[] | null" },
        { name: "shipping", type: "{ city: string; zip?: string | null; window?: string | null }" },
        { name: "lines", type: "{ sku: string; qty: number }[] | null" },
      ]);
      expect(analysis.usesTemporal).toBe(false);
    });

    test("uses Temporal types with temporal, except for nested time fields", () => {
      const analysis = analyzed(
        'SELECT "orderDate", "paidAt", "deliveryTime", "shipping" FROM "Order"',
        true,
      );

      expect(analysis.columns).toEqual([
        { name: "orderDate", type: "Temporal.PlainDate" },
        { name: "paidAt", type: "Temporal.Instant | null" },
        { name: "deliveryTime", type: "Temporal.PlainTime | null" },
        { name: "shipping", type: "{ city: string; zip?: string | null; window?: string | null }" },
      ]);
      expect(analysis.usesTemporal).toBe(true);
    });

    test("names columns by alias, column or aggregate and makes outer-joined tables nullable", () => {
      const analysis = analyzed(
        'SELECT c."name" AS customerName, o."amount", count(*), max(o."orderDate") FROM "Customer" c LEFT JOIN "Order" o ON o."customerID" = c."id" GROUP BY c."name", o."amount"',
      );

      expect(analysis.columns).toEqual([
        { name: "customerName", type: "string" },
        { name: "amount", type: "number | null" },
        { name: "count", type: "number" },
        { name: "max", type: "Date | null" },
      ]);
    });

    test("makes the preceding tables nullable for a RIGHT JOIN", () => {
      expect(
        analyzed(
          'SELECT c."name", o."amount" FROM "Customer" c RIGHT JOIN "Order" o ON o."customerID" = c."id"',
        ).columns,
      ).toEqual([
        { name: "name", type: "string | null" },
        { name: "amount", type: "number" },
      ]);
    });

    test("types arithmetic by its operands, as TailorDB returns it", () => {
      expect(
        analyzed(
          'SELECT "amount" + 1 AS a, "amount" / 7 AS b, "amount" * "weight" AS c, "total" - 1 AS d, "total" + "amount" * 2 AS e, "total" * 1.5 AS f, "total" + "weight" AS g, 1 + 1 AS h FROM "Order"',
        ).columns,
      ).toEqual([
        { name: "a", type: "number" },
        { name: "b", type: "number" },
        { name: "c", type: "number | null" },
        { name: "d", type: "string" },
        { name: "e", type: "string" },
        { name: "f", type: "number" },
        { name: "g", type: "number | null" },
        { name: "h", type: "number" },
      ]);
    });

    test("types literals and names unaliased arithmetic and literals as TailorDB does", () => {
      expect(
        analyzed('SELECT "amount" + 1, \'a\' AS s, true AS b, 1.5 AS f FROM "Order"').columns,
      ).toEqual([
        { name: "expression", type: "number" },
        { name: "s", type: "string" },
        { name: "b", type: "boolean" },
        { name: "f", type: "number" },
      ]);
      expect(analyzed('SELECT 1 FROM "Order"').columns).toEqual([
        { name: "?column?", type: "number" },
      ]);
      expect(
        analyzed('SELECT -"total", ("weight"), -("amount" + 1), -2147483647 FROM "Order"').columns,
      ).toEqual([
        { name: "total", type: "string" },
        { name: "weight", type: "number | null" },
        { name: "expression", type: "number" },
        { name: "?column?", type: "number" },
      ]);
    });

    test("types SUM, AVG, MIN and MAX of decimal fields and of arithmetic", () => {
      expect(
        analyzed(
          'SELECT sum("total") AS s, avg("total") AS a, min("total") AS mn, sum("total" + 1) AS se, count("amount" + 1) AS c, max("amount" * 2) AS m FROM "Order"',
        ).columns,
      ).toEqual([
        { name: "s", type: "string | null" },
        { name: "a", type: "string | null" },
        { name: "mn", type: "string | null" },
        { name: "se", type: "string | null" },
        { name: "c", type: "number" },
        { name: "m", type: "number | null" },
      ]);
    });

    test("types a self-join by alias", () => {
      expect(
        analyzed(
          'SELECT a."id" AS aid, b."amount" AS later FROM "Order" a LEFT JOIN "Order" b ON b."customerID" = a."customerID" AND b."amount" > a."amount"',
        ).columns,
      ).toEqual([
        { name: "aid", type: "string" },
        { name: "later", type: "number | null" },
      ]);
    });

    test("types literal aggregate arguments and exponent literals", () => {
      expect(
        analyzed("SELECT sum(1) AS s, max('a') AS m, 1e3 AS e FROM \"Order\"").columns,
      ).toEqual([
        { name: "s", type: "number | null" },
        { name: "m", type: "string | null" },
        { name: "e", type: "number" },
      ]);
    });

    test("types MIN and MAX of an enum field by its values", () => {
      expect(analyzed('SELECT max("status") AS s FROM "Order"').columns).toEqual([
        { name: "s", type: '"PENDING" | "PAID" | "CANCELLED" | null' },
      ]);
    });

    test("types sum and avg as nullable numbers", () => {
      expect(
        analyzed('SELECT sum("amount") AS s, avg("weight") AS a FROM "Order"').columns,
      ).toEqual([
        { name: "s", type: "number | null" },
        { name: "a", type: "number | null" },
      ]);
    });
  });

  describe("null narrowing", () => {
    test("drops null from a column a WHERE comparison needs a value for", () => {
      const analysis = analyzed(
        'SELECT "weight", "priority", "paidAt", "tags", "deliveryTime" FROM "Order" WHERE "weight" > :w AND "priority" IN (:a, :b) AND "paidAt" NOT BETWEEN :from AND :to AND "deliveryTime" = :t',
      );

      expect(analysis.columns).toEqual([
        { name: "weight", type: "number" },
        { name: "priority", type: '"LOW" | "HIGH"' },
        { name: "paidAt", type: "Date" },
        { name: "tags", type: "string[] | null" },
        { name: "deliveryTime", type: "string" },
      ]);
    });

    test("keeps null when the comparison sits in an OR", () => {
      expect(
        analyzed('SELECT "weight" FROM "Order" WHERE "weight" > :w OR "amount" > 1').columns,
      ).toEqual([{ name: "weight", type: "number | null" }]);
    });

    test("drops null from a column on either side of a WHERE comparison", () => {
      expect(analyzed('SELECT "weight" FROM "Order" WHERE "amount" = "weight"').columns).toEqual([
        { name: "weight", type: "number" },
      ]);
    });

    test("drops null from the columns of arithmetic a WHERE comparison needs a value for", () => {
      expect(
        analyzed('SELECT "weight", "amount" * "weight" AS x FROM "Order" WHERE "weight" * 2 > 1')
          .columns,
      ).toEqual([
        { name: "weight", type: "number" },
        { name: "x", type: "number" },
      ]);
    });

    test.each([
      '"weight" + 1 IS NOT NULL',
      '"weight" * 2 IN (1, 2)',
      '"weight" - 1 BETWEEN 0 AND 1',
      '"amount" > -"weight" / 2',
    ])("drops null from a column of arithmetic in WHERE %s", (condition) => {
      expect(analyzed(`SELECT "weight" FROM "Order" WHERE ${condition}`).columns).toEqual([
        { name: "weight", type: "number" },
      ]);
    });

    test.each([
      { condition: 'NOT ("weight" IS NULL)', type: "number" },
      { condition: 'NOT ("weight" IS NOT NULL)', type: "number | null" },
      { condition: 'NOT ("weight" > 1 OR "amount" > 2)', type: "number" },
      { condition: 'NOT ("weight" > 1 AND "amount" > 2)', type: "number | null" },
      { condition: 'NOT NOT ("weight" > 1)', type: "number" },
      { condition: '("weight" > 1) IS NULL', type: "number | null" },
      { condition: '"amount" IN ("weight", 1)', type: "number | null" },
    ])("narrows WHERE $condition to $type", ({ condition, type }) => {
      expect(analyzed(`SELECT "weight" FROM "Order" WHERE ${condition}`).columns).toEqual([
        { name: "weight", type },
      ]);
    });

    test("drops null from a boolean column a condition reads, true or false", () => {
      for (const condition of ['"active"', 'NOT "active"']) {
        expect(analyzed(`SELECT "active" FROM "Product" WHERE ${condition}`).columns).toEqual([
          { name: "active", type: "boolean" },
        ]);
      }
    });

    test("proves the row of an outer-joined table a WHERE comparison reads", () => {
      expect(
        analyzed(
          'SELECT o."amount", o."weight" FROM "Customer" c LEFT JOIN "Order" o ON o."customerID" = c."id" WHERE o."amount" > :n',
        ).columns,
      ).toEqual([
        { name: "amount", type: "number" },
        { name: "weight", type: "number | null" },
      ]);
    });

    test("drops null only for IS NOT NULL tests AND-ed into WHERE", () => {
      const analysis = analyzed(
        'SELECT "paidAt", "weight", "priority" FROM "Order" WHERE "paidAt" IS NOT NULL AND ("weight" IS NOT NULL OR "amount" > 1) AND "priority" IS NULL',
      );

      expect(analysis.columns).toEqual([
        { name: "paidAt", type: "Date" },
        { name: "weight", type: "number | null" },
        { name: "priority", type: '"LOW" | "HIGH" | null' },
      ]);
    });

    test("drops null from the columns a * selects", () => {
      expect(
        analyzed('SELECT * FROM "Order" WHERE "Order"."paidAt" IS NOT NULL').columns,
      ).toContainEqual({ name: "paidAt", type: "Date" });
    });

    test("keeps the row of an outer-joined table once one of its columns is tested", () => {
      expect(
        analyzed(
          'SELECT c."name", o."amount", o."weight" FROM "Customer" c LEFT JOIN "Order" o ON o."customerID" = c."id" WHERE o."id" IS NOT NULL',
        ).columns,
      ).toEqual([
        { name: "name", type: "string" },
        { name: "amount", type: "number" },
        { name: "weight", type: "number | null" },
      ]);
    });

    test("drops null from RETURNING, except for a column UPDATE sets", () => {
      expect(
        analyzed(
          'UPDATE "Order" SET "weight" = :weight WHERE "paidAt" IS NOT NULL AND "weight" IS NOT NULL RETURNING "paidAt", "weight"',
        ).columns,
      ).toEqual([
        { name: "paidAt", type: "Date" },
        { name: "weight", type: "number | null" },
      ]);
      expect(
        analyzed('DELETE FROM "Order" WHERE "paidAt" IS NOT NULL RETURNING "paidAt"').columns,
      ).toEqual([{ name: "paidAt", type: "Date" }]);
    });

    test("keeps null in UPDATE RETURNING for fields an update hook may set", () => {
      expect(
        analyzed(
          'UPDATE "Customer" SET "name" = :n WHERE "note" IS NOT NULL AND "nickname" IS NOT NULL RETURNING "note", "nickname"',
        ).columns,
      ).toEqual([
        { name: "note", type: "string" },
        { name: "nickname", type: "string | null" },
      ]);
      expect(
        analyzed('UPDATE "Ledger" SET "balance" = :b WHERE "memo" IS NOT NULL RETURNING "memo"')
          .columns,
      ).toEqual([{ name: "memo", type: "string | null" }]);
    });
  });

  describe("GROUP BY aggregates", () => {
    test("drops null from an aggregate of a required column, as every group has a row", () => {
      expect(
        analyzed(
          'SELECT "status", sum("amount") AS s, avg("amount") AS a, max("orderDate") AS d, min("weight") AS w FROM "Order" GROUP BY "status"',
        ).columns,
      ).toEqual([
        { name: "status", type: '"PENDING" | "PAID" | "CANCELLED"' },
        { name: "s", type: "number" },
        { name: "a", type: "number" },
        { name: "d", type: "Date" },
        { name: "w", type: "number | null" },
      ]);
    });

    test("keeps null for an outer-joined column and drops it for a column WHERE proves", () => {
      expect(
        analyzed(
          'SELECT c."id", sum(o."amount") AS s FROM "Customer" c LEFT JOIN "Order" o ON o."customerID" = c."id" GROUP BY c."id"',
        ).columns,
      ).toContainEqual({ name: "s", type: "number | null" });
      expect(
        analyzed(
          'SELECT "status", min("weight") AS w FROM "Order" WHERE "weight" IS NOT NULL GROUP BY "status"',
        ).columns,
      ).toContainEqual({ name: "w", type: "number" });
    });
  });

  describe("parameters", () => {
    test("types each placeholder from the column it is compared with", () => {
      const analysis = analyzed(
        'SELECT "id" FROM "Order" WHERE "status" IN (:s1, :s2) AND "orderDate" BETWEEN :from AND :to AND "customerID" = :customer AND "paid" = :paid LIMIT :limit OFFSET :offset',
      );

      expect(analysis.params).toEqual([
        { name: "s1", type: '"PENDING" | "PAID" | "CANCELLED"' },
        { name: "s2", type: '"PENDING" | "PAID" | "CANCELLED"' },
        { name: "from", type: "Date | string" },
        { name: "to", type: "Date | string" },
        { name: "customer", type: "string" },
        { name: "paid", type: "boolean" },
        { name: "limit", type: "number" },
        { name: "offset", type: "number" },
      ]);
      expect(analysis.paramNames).toEqual([
        "s1",
        "s2",
        "from",
        "to",
        "customer",
        "paid",
        "limit",
        "offset",
      ]);
    });

    test("types LIKE patterns, vector queries and HAVING counts", () => {
      expect(
        analyzed(
          'SELECT "name" FROM "Product" WHERE "name" ILIKE :pattern ORDER BY vector_similarity("description", :query) DESC',
        ).params,
      ).toEqual([
        { name: "pattern", type: "string | null" },
        { name: "query", type: "string" },
      ]);
      expect(
        analyzed(
          'SELECT "customerID" FROM "Order" GROUP BY "customerID" HAVING count(*) > :min AND max("orderDate") < :before',
        ).params,
      ).toEqual([
        { name: "min", type: "number" },
        { name: "before", type: "Date | string | null" },
      ]);
    });

    test("types placeholders in arithmetic and compared with it", () => {
      expect(
        analyzed(
          'SELECT "id" FROM "Order" WHERE "amount" + :d > :min AND "total" * 2 > :t AND "amount" > :e + 1',
        ).params,
      ).toEqual([
        { name: "d", type: "number" },
        { name: "min", type: "number | null" },
        { name: "t", type: "string | number | null" },
        { name: "e", type: "number | null" },
      ]);
      expect(
        analyzed(
          'SELECT "customerID" FROM "Order" GROUP BY "customerID" HAVING sum("total") > :x AND sum("amount") + 1 > :y',
        ).params,
      ).toEqual([
        { name: "x", type: "string | number | null" },
        { name: "y", type: "number | null" },
      ]);
    });

    test("accepts NULL for a placeholder unless TailorDB requires a value there", () => {
      expect(
        analyzed(
          'SELECT o."id" FROM "Customer" c LEFT JOIN "Order" o ON o."customerID" = c."id" WHERE o."weight" = :w AND o."amount" = :a AND "total" > :t AND "total" + :p * 2 > 0 AND :flag',
        ).params,
      ).toEqual([
        { name: "w", type: "number | null" },
        { name: "a", type: "number" },
        { name: "t", type: "string | number" },
        { name: "p", type: "number | null" },
        { name: "flag", type: "boolean | null" },
      ]);
    });

    test("merges a placeholder used where NULL is and is not accepted", () => {
      expect(
        analyzed('SELECT "id" FROM "Order" WHERE "weight" = :x OR "amount" = :x').params,
      ).toEqual([{ name: "x", type: "number" }]);
    });

    test("binds a placeholder used twice once per occurrence", () => {
      const analysis = analyzed('SELECT "id" FROM "Order" WHERE "amount" > :n OR "amount" = :n');

      expect(analysis.params).toEqual([{ name: "n", type: "number" }]);
      expect(analysis.paramNames).toEqual(["n", "n"]);
      expect(analysis.text).toBe('SELECT "id" FROM "Order" WHERE "amount" > $1 OR "amount" = $2');
    });

    test("types written values with the write type and null for optional fields", () => {
      expect(
        analyzed(
          'INSERT INTO "Order" ("customerID", "status", "amount", "total", "paid", "orderDate", "paidAt", "tags", "shipping", "lines") VALUES (:customerID, :status, :amount, :total, :paid, :orderDate, :paidAt, :tags, :shipping, :lines)',
          true,
        ).params,
      ).toEqual([
        { name: "customerID", type: "string" },
        { name: "status", type: '"PENDING" | "PAID" | "CANCELLED"' },
        { name: "amount", type: "number" },
        { name: "total", type: "string | number" },
        { name: "paid", type: "boolean" },
        { name: "orderDate", type: "Temporal.PlainDate | string" },
        { name: "paidAt", type: "Temporal.Instant | string | null" },
        { name: "tags", type: "string[] | null" },
        { name: "shipping", type: "{ city: string; zip?: string | null; window?: string | null }" },
        { name: "lines", type: "{ sku: string; qty: number }[] | null" },
      ]);
    });

    test("types UPDATE assignments, arithmetic and conflict updates", () => {
      expect(
        analyzed(
          'UPDATE "Order" SET "amount" = "amount" + :delta, "priority" = :priority WHERE "id" = :id',
        ).params,
      ).toEqual([
        { name: "delta", type: "number" },
        { name: "priority", type: '"LOW" | "HIGH" | null' },
        { name: "id", type: "string" },
      ]);
      expect(
        analyzed(
          'INSERT INTO "Customer" ("name", "email", "tier") VALUES (:name, :email, :tier) ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name", "note" = :note',
        ).params,
      ).toEqual([
        { name: "name", type: "string" },
        { name: "email", type: "string" },
        { name: "tier", type: '"FREE" | "PRO"' },
        { name: "note", type: "string | null" },
      ]);
    });
  });

  describe("cardinality", () => {
    test.each([
      { source: 'SELECT "id" FROM "Order"', cardinality: "many" },
      { source: 'SELECT "id" FROM "Order" WHERE "id" = :id', cardinality: "maybeOne" },
      { source: 'SELECT "id" FROM "Customer" WHERE "email" = :email', cardinality: "maybeOne" },
      {
        source:
          'SELECT "id" FROM "Order" WHERE "customerID" = :c AND "orderDate" = :d AND "paid" = true',
        cardinality: "maybeOne",
      },
      { source: 'SELECT "id" FROM "Order" WHERE "customerID" = :c', cardinality: "many" },
      { source: 'SELECT "id" FROM "Order" WHERE "id" = :a OR "id" = :b', cardinality: "many" },
      {
        source:
          'SELECT o."id" FROM "Order" o JOIN "Customer" c ON o."customerID" = c."id" WHERE o."id" = :id',
        cardinality: "maybeOne",
      },
      {
        source:
          'SELECT o."id" FROM "Order" o LEFT JOIN "Customer" c ON c."id" = o."customerID" WHERE o."id" = :id',
        cardinality: "maybeOne",
      },
      {
        source:
          'SELECT c."id" FROM "Customer" c JOIN "Order" o ON o."customerID" = c."id" WHERE c."id" = :id',
        cardinality: "many",
      },
      {
        source:
          'SELECT c."id" FROM "Customer" c JOIN "Order" o ON o."customerID" = c."id" WHERE c."email" = :e AND o."orderDate" = :d',
        cardinality: "maybeOne",
      },
      {
        source:
          'SELECT c."id" FROM "Customer" c LEFT JOIN "Order" o ON c."id" = o."customerID" WHERE o."id" = :id',
        cardinality: "maybeOne",
      },
      {
        source:
          'SELECT c."id" FROM "Customer" c LEFT JOIN "Order" o ON c."id" = o."customerID" AND o."id" = :id',
        cardinality: "many",
      },
      {
        source:
          'SELECT o."id" FROM "Order" o FULL JOIN "Customer" c ON c."id" = o."customerID" WHERE o."id" = :id',
        cardinality: "many",
      },
      {
        source:
          'SELECT o."id" FROM "Customer" c RIGHT JOIN "Order" o ON o."id" = :id AND c."id" = o."customerID"',
        cardinality: "many",
      },
      {
        source: 'SELECT a."id" FROM "Order" a JOIN "Order" b ON b."id" = a."id" WHERE a."id" = :id',
        cardinality: "maybeOne",
      },
      { source: 'SELECT "id" FROM "Order" LIMIT 1', cardinality: "maybeOne" },
      { source: 'SELECT count(*) FROM "Order"', cardinality: "one" },
      { source: 'SELECT count(*) FROM "Order" HAVING count(*) > 1', cardinality: "maybeOne" },
      { source: 'SELECT count(*) FROM "Order" OFFSET 1', cardinality: "maybeOne" },
      { source: 'SELECT count(*) FROM "Order" LIMIT 0', cardinality: "maybeOne" },
      { source: 'SELECT count(*) FROM "Order" LIMIT :n', cardinality: "maybeOne" },
      { source: 'SELECT count(*) FROM "Order" LIMIT 1', cardinality: "one" },
      { source: 'SELECT "id" FROM "Product" WHERE "code" = -1', cardinality: "maybeOne" },
      {
        source: 'SELECT "status", count(*) FROM "Order" GROUP BY "status"',
        cardinality: "many",
      },
      {
        source: 'INSERT INTO "Event" ("name") VALUES (:name) RETURNING "id"',
        cardinality: "one",
      },
      { source: 'INSERT INTO "Event" DEFAULT VALUES RETURNING "id"', cardinality: "one" },
      {
        source: 'INSERT INTO "Event" ("name") VALUES (:a), (:b) RETURNING "id"',
        cardinality: "many",
      },
      {
        source:
          'INSERT INTO "Event" ("id", "name") VALUES (:id, :name) ON CONFLICT ("id") DO NOTHING RETURNING "id"',
        cardinality: "maybeOne",
      },
      {
        source:
          'INSERT INTO "Event" ("id", "name") VALUES (:id, :name) ON CONFLICT ("id") DO UPDATE SET "name" = :n RETURNING "id"',
        cardinality: "one",
      },
      { source: 'INSERT INTO "Event" ("name") VALUES (:name)', cardinality: "none" },
      {
        source: 'UPDATE "Event" SET "name" = :name WHERE "id" = :id RETURNING *',
        cardinality: "maybeOne",
      },
      { source: 'UPDATE "Event" SET "name" = :name RETURNING "id"', cardinality: "many" },
      { source: 'DELETE FROM "Event" WHERE "id" = :id', cardinality: "none" },
    ])("$source → $cardinality", ({ source, cardinality }) => {
      expect(analyzed(source).cardinality).toBe(cardinality);
    });
  });

  describe("names", () => {
    test("allows ORDER BY an output alias", () => {
      expect(
        analyzed('SELECT "status", count(*) AS n FROM "Order" GROUP BY "status" ORDER BY n DESC')
          .cardinality,
      ).toBe("many");
    });

    test("resolves the namespace from the tables", () => {
      expect(analyzed('SELECT "name" FROM "Event"').namespace).toBe("other");
    });

    test("orders by a result column before an input column", () => {
      expect(
        analyzed(
          'SELECT a."amount" AS "amount" FROM "Order" a JOIN "Order" b ON a."id" = b."id" ORDER BY "amount"',
        ).columns,
      ).toEqual([{ name: "amount", type: "number" }]);
    });

    test("names a negated literal ?column?", () => {
      expect(analyzed('SELECT -(1) FROM "Order"').columns).toEqual([
        { name: "?column?", type: "number" },
      ]);
    });
  });

  describe("serializeSqlDefinitions", () => {
    test("changes when a field or a table gains an update hook", () => {
      const serialize = (...types: TailorAnyDBType[]) =>
        serializeSqlDefinitions({
          namespaces: new Map([["main", namespace(...types)]]),
          temporal: false,
        });
      const plain = db.table("Item", { memo: db.string({ optional: true }) });
      const fieldHook = db.table("Item", {
        memo: db.string({ optional: true }).hooks({ update: ({ input }) => input }),
      });
      const typeHook = db
        .table("Item", { memo: db.string({ optional: true }) })
        .hooks({ update: () => ({}) });

      expect(new Set([serialize(plain), serialize(fieldHook), serialize(typeHook)]).size).toBe(3);
    });
  });

  describe("accepted forms", () => {
    test.each([
      'SELECT "id" FROM "Order" WHERE "status" != \'PAID\' AND NOT "paid"',
      'SELECT "id" FROM "Order" WHERE 10 < "amount" AND :min < "amount"',
      'SELECT "id" FROM "Order" WHERE "amount" IN (:a + 1, 2) AND "amount" BETWEEN :x - 1 AND "amount" * 2',
      'SELECT "id" FROM "Order" WHERE "amount" + \'1\' > 0',
      'SELECT "id" FROM "Order" WHERE "status" LIKE \'PA%\' AND "status" ~ \'^P[A-Z]+$\'',
      'SELECT "id" FROM "Customer" WHERE "name" LIKE "tier"',
      'SELECT "id" FROM "Order" WHERE "orderDate" = \'2026-1-5\' AND "customerID" = \'{aaaaaaaa-0000-4000-8000-000000000001}\' AND "paid" = \'TRUE\' AND "deliveryTime" = \'9:05\' AND "total" > 1e3',
      'SELECT "status", count("tags") AS n FROM "Order" GROUP BY "status" HAVING count("tags") > 0',
      'SELECT "id" FROM "Order" WHERE "id" = :id FOR UPDATE SKIP LOCKED',
      'SELECT "id" FROM "Order" LIMIT \'10\'',
      'UPDATE "Order" SET "tags" = ARRAY[\'a\', \'b\'], "status" = \'PAID\', "shipping" = \'{"city": "Osaka"}\' WHERE "id" = :id',
    ])("%s", (source) => {
      expect(analyzed(source).namespace).toBe("main");
    });
  });

  describe("diagnostics", () => {
    test.each([
      {
        source: 'SELECT "id" FROM "customer"',
        message: "table 'customer' not found",
        at: '"customer"',
      },
      {
        source: 'SELECT "nope" FROM "Order"',
        message: "field 'nope' not found",
        at: '"nope"',
      },
      {
        source: 'SELECT "name" FROM "Customer" c JOIN "Product" p ON c."id" = p."id"',
        message: "field 'name' is ambiguous - Hint: use table.field syntax",
        at: '"name"',
      },
      {
        source: 'SELECT "amount" FROM "Order" a JOIN "Order" b ON a."id" = b."id"',
        message: "field 'amount' is ambiguous - Hint: use table.field syntax",
        at: '"amount"',
      },
      {
        source: 'SELECT x."name" FROM "Customer" x JOIN "Order" x ON x."id" = x."id"',
        message:
          "table alias `x` specified more than once - Hint: use a unique alias to distinguish",
        at: "x",
      },
      {
        source: 'SELECT x."id" FROM "Order" o',
        message: "table 'x' not found",
        at: "x",
      },
      {
        source: 'SELECT c."id" FROM "Customer" c JOIN "Event" e ON c."name" = e."name"',
        message: "Query references tables from multiple namespaces: main, other.",
        at: '"Event"',
      },
      {
        source: 'SELECT * FROM "Order" o JOIN "Customer" c ON c."id" = o."customerID"',
        message:
          'Column "id" appears more than once in the result, and TailorDB keeps only the last; give the columns distinct names with AS',
        at: "*",
      },
      {
        source: 'SELECT * FROM "Customer" c JOIN "Product" p ON c."id" = p."id"',
        message:
          'Columns "id" and "name" appear more than once in the result, and TailorDB keeps only the last of each; give the columns distinct names with AS',
        at: "*",
      },
      {
        source: 'SELECT "amount" + 1, "amount" * 2 FROM "Order"',
        message:
          'Column "expression" appears more than once in the result, and TailorDB keeps only the last; give the columns distinct names with AS',
        at: '"amount" * 2',
      },
      {
        source: 'SELECT count(*), count("weight") FROM "Order"',
        message:
          'Column "count" appears more than once in the result, and TailorDB keeps only the last; give the columns distinct names with AS',
        at: 'count("weight")',
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "status" IN (\'PAID\', \'NONE\')',
        message: "field 'status' expected valid enum value, got 'NONE'",
        at: "'NONE'",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "tags" = :tags',
        message: "cannot query array field `tags`",
        at: '"tags"',
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "shipping" = :s',
        message: "cannot query nested field `shipping`",
        at: '"shipping"',
      },
      {
        source: 'SELECT min("id") FROM "Order"',
        message: "MAX/MIN requires comparable field, got field `id`",
        at: 'min("id")',
      },
      {
        source: 'SELECT sum("status") FROM "Order"',
        message: "SUM/AVG requires numeric field, got field `status`",
        at: 'sum("status")',
      },
      {
        source: 'SELECT "paid" + 1 AS x FROM "Order"',
        message: "binary arithmetic expression requires numeric field, got field type `Boolean`",
        at: '"paid"',
      },
      {
        source: "SELECT 'a' + 1 AS x FROM \"Order\"",
        message: "binary arithmetic expression requires numeric field, got field type `String`",
        at: "'a'",
      },
      {
        source: 'SELECT "amount" / 0 AS a FROM "Order"',
        message: "Dividing by zero fails in TailorDB SQL",
        at: "0",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "weight" / 0.0 > 1',
        message: "Dividing by zero fails in TailorDB SQL",
        at: "0.0",
      },
      {
        source: 'UPDATE "Order" SET "amount" = "amount" / 0 WHERE "id" = :id',
        message: "Dividing by zero fails in TailorDB SQL",
        at: "0",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "amount" > 2147483648',
        message: "numeric literal `2147483648` is out of range for 32-bit integer",
        at: "2147483648",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "amount" IN (1, 2147483648)',
        message: "numeric literal `2147483648` is out of range for 32-bit integer",
        at: "2147483648",
      },
      {
        source: 'SELECT -2147483648 AS x FROM "Order"',
        message: "numeric literal `2147483648` is out of range for 32-bit integer expressions",
        at: "2147483648",
      },
      {
        source:
          'UPDATE "Order" SET "amount" = :a WHERE "id" = :id RETURNING "id", "amount" + 1 AS x',
        message: "RETURNING takes only columns and * in TailorDB SQL",
        at: '"amount" + 1 AS x',
      },
      {
        source: 'DELETE FROM "Order" WHERE "id" = :id RETURNING count(*)',
        message: "Aggregate functions are not supported in RETURNING clause",
        at: "count(*)",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "amount" = :x AND "status" = :x',
        message:
          'Placeholder :x is used as both number and "PENDING" | "PAID" | "CANCELLED"; use separate placeholders',
        at: ":x",
      },
      {
        source: 'SELECT "id" FROM "Product" ORDER BY vector_similarity("name", :q)',
        message: "cannot query non-vector field `name`",
        at: '"name"',
      },
      {
        source:
          'INSERT INTO "Customer" ("name", "email", "tier") VALUES (:n, :e, :t) ON CONFLICT ("name") DO NOTHING',
        message: "field `name` is not unique",
        at: '"name"',
      },
      {
        source: 'INSERT INTO "Event" ("name") VALUES (:a, :b)',
        message: "INSERT expected 1 values for columns [name], got 2",
        at: "(:a, :b)",
      },
      {
        source: 'INSERT INTO "Event" ("name", "name") VALUES (:a, :b)',
        message: "field 'name' appears multiple times in INSERT column list",
        at: '"name"',
      },
      {
        source: 'UPDATE "Customer" SET "name" = "name" + :suffix',
        message: 'Arithmetic needs an Integer, Float or Decimal field, and "name" is string',
        at: '"name" + :suffix',
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "orderDate" = "paidAt"',
        message: "type mismatch: field 'orderDate' is date, but field 'paidAt' is datetime",
        at: '"paidAt"',
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "amount" = \'abc\'',
        message: "field 'amount' expected integer, got abc",
        at: "'abc'",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "customerID" = \'x\'',
        message: "field 'customerID' expected uuid, got x",
        at: "'x'",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "orderDate" = \'2026-13-01\'',
        message: "field 'orderDate' expected date, got 2026-13-01",
        at: "'2026-13-01'",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE :a + :b > 0',
        message:
          "cannot determine type for arithmetic between untyped values - Hint: use a typed column on at least one side",
        at: ":a",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "amount" > -:p',
        message:
          "cannot determine type for unary arithmetic on untyped value - Hint: use a typed column or an explicitly typed literal as the operand",
        at: "-:p",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "amount"',
        message: "type mismatch: expected boolean, got integer",
        at: '"amount"',
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "amount" LIKE \'1%\'',
        message: "field 'amount' expected string or enum for like operator (~~), got integer",
        at: '"amount"',
      },
      {
        source: 'SELECT "id" FROM "Customer" WHERE "name" ~ \'^(a+)+$\'',
        message: "regex pattern too complex: star-height 2 exceeds limit of 1",
        at: "'^(a+)+$'",
      },
      {
        source: 'SELECT "id" FROM "Customer" WHERE "name" ~ \'(?=a)\'',
        message:
          "invalid regex pattern: regex parse error:\n    (?=a)\n    ^^^\nerror: look-around, including look-ahead and look-behind, is not supported",
        at: "'(?=a)'",
      },
      {
        source: 'SELECT "id" FROM "Customer" WHERE "name" ~* \'a{300}\'',
        message: "regex pattern too complex: repeat bound 300 exceeds limit of 255",
        at: "'a{300}'",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "tags" IS NULL',
        message: "cannot query array field `tags`",
        at: '"tags"',
      },
      {
        source: 'SELECT "tags" FROM "Order" ORDER BY "tags"',
        message: "cannot query array field `tags`",
        at: '"tags"',
      },
      {
        source: 'SELECT count(*) AS n FROM "Order" GROUP BY "shipping"',
        message: "cannot query nested field `shipping`",
        at: '"shipping"',
      },
      {
        source: 'SELECT "status", count(*) FROM "Order"',
        message:
          "field `Order.status` must appear in the GROUP BY clause or be used in an aggregate function",
        at: '"status"',
      },
      {
        source: 'SELECT * FROM "Event" GROUP BY "name"',
        message:
          "field `Event.id` must appear in the GROUP BY clause or be used in an aggregate function",
        at: "*",
      },
      {
        source: 'SELECT "name" FROM "Event" HAVING count(*) > 1',
        message:
          "field `Event.name` must appear in the GROUP BY clause or be used in an aggregate function",
        at: '"name"',
      },
      {
        source: 'SELECT count(*) AS n FROM "Order" GROUP BY "status" ORDER BY "amount"',
        message:
          "field `Order.amount` must appear in the GROUP BY clause or be used in an aggregate function",
        at: '"amount"',
      },
      {
        source:
          'SELECT "name", count(*) AS n FROM "Product" GROUP BY "name" ORDER BY vector_similarity("description", :q)',
        message:
          "cannot order by vector field `description` with aggregate functions or GROUP BY clause",
        at: 'vector_similarity("description", :q)',
      },
      {
        source: 'SELECT "id" FROM "Order" LIMIT 9999999999',
        message: "field '?column?' expected integer, got 9999999999",
        at: "9999999999",
      },
      {
        source: 'SELECT "id" FROM "Order" OFFSET -1',
        message: "LIMIT and OFFSET take a number that is not negative",
        at: "-1",
      },
      {
        source: 'SELECT "id" FROM "Order" LIMIT NULL',
        message:
          "field '?column?' is required but got null - Hint: provide a non-null value or make the field optional in schema",
        at: "NULL",
      },
      {
        source: 'SELECT count(*) FROM "Order" FOR UPDATE',
        message: "row locks are not allowed with aggregate functions",
        at: "FOR UPDATE",
      },
      {
        source:
          'SELECT o."id" FROM "Order" o LEFT JOIN "Customer" c ON c."id" = o."customerID" FOR SHARE',
        message: "row locks are not allowed with OUTER JOINs",
        at: "FOR SHARE",
      },
      {
        source:
          'SELECT a."id" FROM "Order" a JOIN "Order" b ON b."id" = c."id" JOIN "Order" c ON c."id" = a."id"',
        message: "table 'c' not found",
        at: "c",
      },
      {
        source: 'INSERT INTO "Event" ("name") VALUES (NULL)',
        message:
          "field 'name' is required but got null - Hint: provide a non-null value or make the field optional in schema",
        at: "NULL",
      },
      {
        source: 'UPDATE "Order" SET "amount" = "amount" * 1.5',
        message: "field 'amount' expected integer, got 1.5",
        at: "1.5",
      },
      {
        source: 'UPDATE "Order" SET "amount" = 2147483648',
        message: "field 'amount' expected integer, got 2147483648",
        at: "2147483648",
      },
      {
        source: 'UPDATE "Order" SET "tags" = ARRAY[\'a\', NULL]',
        message:
          "array element in field 'tags' cannot be null - Hint: remove null elements from the array",
        at: "NULL",
      },
      {
        source: 'UPDATE "Order" SET "amount" = ARRAY[1]',
        message: "field 'amount' expected integer, got array",
        at: "ARRAY[1]",
      },
      {
        source: 'UPDATE "Order" SET "shipping" = \'{"town": "Osaka"}\'',
        message: "field `city` is required",
        at: '\'{"town": "Osaka"}\'',
      },
      {
        source: 'UPDATE "Event" SET "id" = :x',
        message: "cannot update field `id`",
        at: '"id"',
      },
      {
        source: 'UPDATE "Order" SET "weight" = "amount"',
        message: "type mismatch: column 'amount' is integer but 'weight' is float",
        at: '"amount"',
      },
      {
        source:
          'INSERT INTO "Customer" ("name", "email", "tier") VALUES (:n, :e, :t) ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."tier"',
        message: "field `tier` has different type from field `name`",
        at: 'EXCLUDED."tier"',
      },
      {
        source: 'SELECT "amount" / -0 AS a FROM "Order"',
        message: "Dividing by zero fails in TailorDB SQL",
        at: "-0",
      },
      {
        source: 'SELECT :a FROM "Order"',
        message: "placeholders are not supported in scalar expressions yet",
        at: ":a",
      },
      {
        source: 'SELECT "amount" + :a AS x FROM "Order"',
        message: "placeholders are not supported in scalar expressions yet",
        at: ":a",
      },
      {
        source: 'SELECT sum(:a) FROM "Order"',
        message: "placeholders are not supported in scalar expressions yet",
        at: ":a",
      },
      {
        source: 'SELECT NULL AS x FROM "Order"',
        message: "NULL literal is not supported in scalar expressions",
        at: "NULL",
      },
      {
        source: 'SELECT "amount" + NULL AS x FROM "Order"',
        message: "NULL literal is not supported in scalar expressions",
        at: "NULL",
      },
      {
        source: 'SELECT sum(NULL) FROM "Order"',
        message: "NULL literal is not supported in scalar expressions",
        at: "NULL",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE count(*) > 1',
        message: "aggregate functions are not allowed in WHERE",
        at: "count(*)",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "status" = ARRAY[\'a\']',
        message: "array literals are not supported in expressions",
        at: "ARRAY['a']",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "amount" = 1_000',
        message: "numeric literal `1_000` is out of range for 32-bit integer",
        at: "1_000",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE :p LIKE \'x%\'',
        message:
          "cannot determine type for left side of like operator (~~) - Hint: use a typed column on the left side",
        at: ":p",
      },
      {
        source: 'SELECT "id" FROM "Customer" WHERE "name" LIKE 1',
        message: "right side of like operator (~~) expected string or enum, got integer",
        at: "1",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "paid" AND "amount"',
        message: "right side of AND expected boolean, got integer",
        at: '"amount"',
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE :p IN (1, 2)',
        message:
          "cannot determine type for left side of IN expression - Hint: use a typed column on the left side",
        at: ":p",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE :a = :b',
        message:
          "cannot determine type for comparison between untyped values - Hint: use a typed column on at least one side",
        at: ":a",
      },
      {
        source: 'SELECT "id" FROM "Customer" WHERE "name" ~ \'(a)\\1\'',
        message:
          "invalid regex pattern: regex parse error:\n    (a)\\1\n       ^^\nerror: backreferences are not supported",
        at: "'(a)\\1'",
      },
      {
        source: 'SELECT "id" FROM "Customer" WHERE "name" ~ \'\\yab\'',
        message:
          "invalid regex pattern: regex parse error:\n    \\yab\n    ^^\nerror: unrecognized escape sequence",
        at: "'\\yab'",
      },
      {
        source: 'UPDATE "Order" SET "tags" = ARRAY[:t]',
        message: "array elements cannot contain placeholders, got :t",
        at: ":t",
      },
      {
        source: 'SELECT "status" FROM "Order" WHERE "amount" > 1 HAVING count(*) > 1',
        message:
          "field `Order.status` must appear in the GROUP BY clause or be used in an aggregate function",
        at: '"status"',
      },
      {
        source: 'SELECT x.* FROM "Order"',
        message: "table 'x' not found",
        at: "x",
      },
      {
        source: 'SELECT "status", count(*) AS n FROM "Order" GROUP BY "status" HAVING n > :min',
        message: "field 'n' not found",
        at: "n",
      },
    ])("$source", ({ source, message, at }) => {
      expect(rejected(source)).toEqual([{ message, at }]);
    });

    test("reports row locks with GROUP BY and ORDER BY names that match several columns", () => {
      expect(
        rejected('SELECT "id" FROM "Order" GROUP BY "id" HAVING "id" = :id FOR UPDATE'),
      ).toEqual([{ message: "row locks are not allowed with GROUP BY clause", at: "FOR UPDATE" }]);
      expect(rejected('SELECT "amount" AS x, "weight" AS x FROM "Order" ORDER BY x')).toEqual([
        { message: "ORDER BY `x` is ambiguous - Hint: use table.field syntax", at: "x" },
      ]);
    });

    test("reports what fails for HAVING without GROUP BY, which groups the rows", () => {
      expect(
        rejected('SELECT o."id" FROM "Order" o HAVING count(*) > 1 ORDER BY "amount" FOR UPDATE'),
      ).toEqual([
        {
          message:
            "field `o.id` must appear in the GROUP BY clause or be used in an aggregate function",
          at: 'o."id"',
        },
        {
          message:
            "field `o.amount` must appear in the GROUP BY clause or be used in an aggregate function",
          at: '"amount"',
        },
        { message: "row locks are not allowed with HAVING clause", at: "FOR UPDATE" },
      ]);
      expect(
        rejected(
          'SELECT * FROM "Product" HAVING count(*) > 0 ORDER BY vector_similarity("description", :q)',
        ),
      ).toEqual([
        {
          message:
            "field `Product.id` must appear in the GROUP BY clause or be used in an aggregate function",
          at: "*",
        },
        {
          message: "cannot order by vector field `description` with HAVING clause",
          at: 'vector_similarity("description", :q)',
        },
      ]);
    });

    test("reports failures it checks itself along with the error TailorDB reports", () => {
      expect(rejected('SELECT "nope" / 0 AS x FROM "Order" OFFSET -1')).toEqual([
        { message: "field 'nope' not found", at: '"nope"' },
        { message: "Dividing by zero fails in TailorDB SQL", at: "0" },
        { message: "LIMIT and OFFSET take a number that is not negative", at: "-1" },
      ]);
    });

    test("reports parse errors at their place", () => {
      expect(rejected('SELECT "id" FROM "Order" WHERE "id" = :id::uuid')).toEqual([
        {
          message:
            "failed to parse: the query may contain unsupported syntax. expected: end of statement, found: ::",
          at: "::",
        },
      ]);
    });
  });
});
