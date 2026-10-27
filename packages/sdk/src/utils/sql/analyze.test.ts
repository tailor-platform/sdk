import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/index";
import { toSchemaOutput } from "#/utils/test/internal";
import { analyzeSql, type SqlDefinitions } from "./analyze";
import type { TailorAnyDBType } from "#/configure/services/tailordb/types";

const customer = db.table("Customer", {
  name: db.string(),
  email: db.string().unique(),
  tier: db.enum(["FREE", "PRO"]),
  note: db.string({ optional: true }),
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
});

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
      ["main", namespace(customer, order, product)],
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
        'SELECT "weight", "priority", "paidAt", "tags", "deliveryTime" FROM "Order" WHERE "weight" > :w AND "priority" IN (:a, :b) AND "paidAt" NOT BETWEEN :from AND :to AND "deliveryTime" LIKE :t',
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
        { name: "pattern", type: "string" },
        { name: "query", type: "string" },
      ]);
      expect(
        analyzed(
          'SELECT "customerID" FROM "Order" GROUP BY "customerID" HAVING count(*) > :min AND max("orderDate") < :before',
        ).params,
      ).toEqual([
        { name: "min", type: "number" },
        { name: "before", type: "Date | string" },
      ]);
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
        { name: "total", type: "string" },
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
      { source: 'SELECT "id" FROM "Order" LIMIT 1', cardinality: "maybeOne" },
      { source: 'SELECT count(*) FROM "Order"', cardinality: "one" },
      { source: 'SELECT count(*) FROM "Order" HAVING count(*) > 1', cardinality: "maybeOne" },
      { source: 'SELECT count(*) FROM "Order" OFFSET 1', cardinality: "maybeOne" },
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
          'INSERT INTO "Event" ("id", "name") VALUES (:id, :name) ON CONFLICT ("id") DO UPDATE SET "name" = :n WHERE "name" = :old RETURNING "id"',
        cardinality: "maybeOne",
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
  });

  describe("diagnostics", () => {
    test.each([
      {
        source: 'SELECT "id" FROM "customer"',
        message:
          'Table "customer" is not defined in any TailorDB namespace; did you mean "Customer"?',
        at: '"customer"',
      },
      {
        source: 'SELECT "nope" FROM "Order"',
        message: 'Column "nope" does not exist in "Order"',
        at: '"nope"',
      },
      {
        source: 'SELECT "name" FROM "Customer" c JOIN "Product" p ON c."id" = p."id"',
        message: 'Column "name" is ambiguous: it exists in "Customer" and "Product"',
        at: '"name"',
      },
      {
        source: 'SELECT x."name" FROM "Customer" x JOIN "Order" x ON x."id" = x."id"',
        message: 'Table or alias "x" is used more than once',
        at: "x",
      },
      {
        source: 'SELECT x."id" FROM "Order" o',
        message: 'Table or alias "x" is not in the query',
        at: "x",
      },
      {
        source: 'SELECT a."id" FROM "Order" a JOIN "Order" b ON a."id" = b."id"',
        message: 'Joining "Order" more than once is not supported by TailorDB SQL',
        at: '"Order"',
      },
      {
        source: 'SELECT c."id" FROM "Customer" c JOIN "Event" e ON c."name" = e."name"',
        message: "Query references tables from multiple namespaces: main, other.",
        at: '"Event"',
      },
      {
        source: 'SELECT * FROM "Customer" c JOIN "Product" p ON c."id" = p."id"',
        message:
          'Column "id" appears more than once in the result, and TailorDB keeps only the last; give the columns distinct names with AS',
        at: "*",
      },
      {
        source: 'SELECT count(*), count("weight") FROM "Order"',
        message:
          'Column "count" appears more than once in the result, and TailorDB keeps only the last; give the columns distinct names with AS',
        at: 'count("weight")',
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "status" IN (\'PAID\', \'NONE\')',
        message: "'NONE' is not a value of \"status\": PENDING, PAID, CANCELLED",
        at: "'NONE'",
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "tags" = :tags',
        message: 'Comparing the array field "tags" is not supported by TailorDB SQL',
        at: '"tags"',
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "shipping" = :s',
        message: 'Comparing the nested field "shipping" is not supported by TailorDB SQL',
        at: '"shipping"',
      },
      {
        source: 'SELECT min("id") FROM "Order"',
        message:
          "MIN takes an Integer, Float, String, Enum, Date, Time or DateTime field, not uuid",
        at: 'min("id")',
      },
      {
        source: 'SELECT sum("total") FROM "Order"',
        message: "SUM takes an Integer or Float field, not decimal",
        at: 'sum("total")',
      },
      {
        source: 'SELECT "id" FROM "Order" WHERE "amount" = :x AND "status" = :x',
        message:
          'Placeholder :x is used as both number and "PENDING" | "PAID" | "CANCELLED"; use separate placeholders',
        at: ":x",
      },
      {
        source: 'SELECT "id" FROM "Product" ORDER BY vector_similarity("name", :q)',
        message: 'vector_similarity takes a vector field, and "name" is not one',
        at: '"name"',
      },
      {
        source:
          'INSERT INTO "Customer" ("name", "email", "tier") VALUES (:n, :e, :t) ON CONFLICT ("name") DO NOTHING',
        message: 'ON CONFLICT takes "id" or a unique field, and "name" is not unique',
        at: '"name"',
      },
      {
        source: 'INSERT INTO "Event" ("name") VALUES (:a, :b)',
        message: "VALUES has 2 values for 1 column",
        at: "(:a, :b)",
      },
      {
        source: 'INSERT INTO "Event" ("name", "name") VALUES (:a, :b)',
        message: 'Column "name" is listed more than once',
        at: '"name"',
      },
      {
        source: 'UPDATE "Customer" SET "name" = "name" + :suffix',
        message: 'Arithmetic needs an Integer, Float or Decimal field, and "name" is string',
        at: '"name" + :suffix',
      },
      {
        source: 'SELECT "status", count(*) AS n FROM "Order" GROUP BY "status" HAVING n > :min',
        message: 'Column "n" does not exist in "Order"',
        at: "n",
      },
    ])("$message", ({ source, message, at }) => {
      expect(rejected(source)).toContainEqual({ message, at });
    });

    test("reports parse errors at their place", () => {
      expect(rejected('SELECT "id" FROM "Order" WHERE "id" = :id::uuid')).toEqual([
        { message: "Casts (::) are not supported by TailorDB SQL", at: "::" },
      ]);
    });
  });
});
