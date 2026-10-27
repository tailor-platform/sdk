---
description: "Import .sql files into functions, with parameters and rows typed from your TailorDB tables and the query checked against them."
---

# SQL Files

Write a TailorDB query in a `.sql` file and import it from a resolver, executor, workflow job, or auth hook. TypeScript checks the query against the TailorDB tables in your `tailor.config.ts` and types its parameters and rows, and `tailor deploy` bundles it into the function.

```sql
-- queries/orders_by_status.sql
SELECT "id", "amount", "orderDate"
FROM "Order"
WHERE "customerID" = :customerID AND "status" = :status
```

```typescript
import "@tailor-platform/sdk/runtime/globals";
import { createResolver, t } from "@tailor-platform/sdk";
import ordersByStatus from "../queries/orders_by_status.sql";

export default createResolver({
  name: "paidOrderCount",
  operation: "query",
  input: { customerID: t.uuid() },
  body: async ({ input }) => {
    const client = new tailordb.Client({ namespace: ordersByStatus.namespace });
    await client.connect();
    try {
      // { id: string; amount: number; orderDate: Date }[]
      const orders = await ordersByStatus.run(client, {
        customerID: input.customerID,
        status: "PAID",
      });
      return { count: orders.length };
    } finally {
      await client.end();
    }
  },
  output: t.object({ count: t.int() }),
});
```

## Setup

Typing `.sql` imports needs TypeScript 7.1 or later.

Add the SDK as a content mapper for `.sql` files in `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    // ...
  },
  "contentMappers": [{ "package": "@tailor-platform/sdk", "extensions": [".sql"] }],
}
```

The SDK reads the tables of the `tailor.config.ts` in the directory of that `tsconfig.json`, or in the nearest directory above it.

Type-check with `--runExternalCode`, which lets TypeScript run the SDK to type `.sql` files. Without it, TypeScript reports an error for `contentMappers`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit --runExternalCode"
  }
}
```

In VS Code, use the TypeScript 7 extension with your project's TypeScript, and trust the workspace: TypeScript types `.sql` imports only in a trusted workspace.

## Writing Queries

A `.sql` file holds one `SELECT`, `INSERT`, `UPDATE`, or `DELETE` statement in the SQL that TailorDB runs (see [Supported SQL queries](https://docs.tailor.tech/guides/function/accessing-tailordb#supported-sql-queries)). Besides what that reference lists, TailorDB runs:

- Arithmetic with `+`, `-`, `*`, `/`, parentheses, and signs on Integer, Float, and Decimal values: in the select list, in conditions, and inside `COUNT`, `SUM`, `AVG`, `MIN`, and `MAX`. In `HAVING`, arithmetic can use aggregates.
- Literals in the select list and as aggregate arguments, as in `SELECT 1 AS found` or `SUM(1)`.
- `NOT` before a condition, a Boolean column or parameter as a condition, `!=`, and expressions on either side of a comparison and in `IN` and `BETWEEN`.
- Self-joins, which join a table to itself under different aliases. Read permissions apply to each alias.
- `SUM`, `AVG`, `MIN`, and `MAX` of Decimal fields.
- `FOR NO KEY UPDATE`, `FOR KEY SHARE`, `NOWAIT`, and `SKIP LOCKED`.

Anything else is an error at its place in the file: for example a cast (`::`), a function other than `COUNT`, `SUM`, `AVG`, `MIN`, and `MAX`, a subquery, `NULLS FIRST`, arithmetic in `ORDER BY` (order by the name you give it with `AS` instead), anything but columns and `*` in `RETURNING`, or `WHERE` after `ON CONFLICT ... DO UPDATE`, which the reference lists but TailorDB rejects. So is a query TailorDB would reject when it runs:

- Compared values must have the same type, except that numbers compare with numbers. A string compared with or written to a column must be a valid value of the column's type.
- Conditions, `GROUP BY`, and `ORDER BY` cannot use array or nested fields.
- With `GROUP BY`, an aggregate in the select list, or `HAVING`, every column that the select list, `HAVING`, or `ORDER BY` reads outside an aggregate must be in `GROUP BY`.
- `LIKE` and the regular-expression operators need a String or Enum value on their left. A regular expression cannot nest repetition, as in `(a+)+`, or repeat more than 255 times.
- Integers must fit in 32 bits, and dividing by a literal zero fails.

When you write a query:

- Write `AS` before a column alias, as in `SELECT "name" AS n`; a table alias does not need it.
- Put a space between `>`, `>=`, or `<>` and a sign after it: TailorDB reads `"amount">-1` as one unknown operator.
- Name each parameter with a colon, as in `:status`, and use a name as often as you need. A parameter takes the type of the value it is compared with, written to, or combined with in arithmetic, and it accepts `null` unless TailorDB requires a value there, as for a required column or `LIMIT`. A Decimal parameter accepts a string or a number.
- Table and column names are case-sensitive, as in TailorDB, whether or not you quote them.
- The tables of one query must belong to one TailorDB namespace. Tables of [external namespaces](../../configuration.md#external-resources) are not available.
- Columns of the result must have distinct names. Give same-named columns of joined tables different names with `AS`. Without `AS`, TailorDB names arithmetic `expression`, a literal `?column?`, and a column with a sign after the column, so name them when they would share a name.

## Running Queries

Call `.run()` with a `tailordb.Client` for the query's namespace, `query.namespace`, or with a transaction created from one, and with the parameters when the query has any. It resolves to the rows, shaped by how many the query can return:

| The query                                                                                                                                                   | `.run()` resolves to |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Matches `id`, a unique field, or a unique index of every table it reads, or has `LIMIT 1`                                                                   | The row, or `null`   |
| Inserts one row with `RETURNING` and `ON CONFLICT ... DO NOTHING`                                                                                           | The row, or `null`   |
| Aggregates without `GROUP BY`, `HAVING`, `OFFSET`, or a `LIMIT` other than a positive number, or inserts one row with `RETURNING` and no such `ON CONFLICT` | The row              |
| Inserts, updates, or deletes without `RETURNING`                                                                                                            | Nothing              |
| Anything else                                                                                                                                               | An array of rows     |

A query matches a table's key when `WHERE` compares each column of the key with `=` to a value, or to a column of a table the query already matches, outside any `OR`. A join counts too: joining a table on its `id` or another unique key to a matched table's column, as when you join an order's customer, matches that table. The `ON` of a `LEFT JOIN` matches only the joined table, unless `WHERE` needs a value in a column of that table, and the `ON` of a `RIGHT JOIN` or `FULL JOIN` matches no table.

A column is nullable when its field is optional or its table is outer-joined, and arithmetic is nullable when one of its columns is. A column that the statement's `WHERE` compares, or tests with `IS NOT NULL`, `IN`, `BETWEEN`, or `LIKE`, or a Boolean column it tests, is typed without `null` when every row must pass the test, so not for a test inside an `OR`; this also holds when the column is part of arithmetic there. Under `NOT`, a test counts when every row must fail it and failing still needs a value: `NOT ("weight" > 1)`, `NOT ("paidAt" IS NULL)`, and each test of `NOT ("weight" > 1 OR "paidAt" IS NULL)` drop `null`, while `NOT ("paidAt" IS NOT NULL)` keeps it. That also proves the column's table has a row, so the required columns of an outer-joined table lose `null` too. In `UPDATE ... RETURNING`, a field the `UPDATE` sets or an update hook may set keeps `null`, and so do all fields of a table with a type-level update hook, as hooks run after `WHERE`. With `GROUP BY`, `SUM`, `AVG`, `MIN`, and `MAX` of a column or arithmetic that is not nullable are not nullable either, as every group has a row.

Arithmetic in the select list is typed as `number`, except that arithmetic with a Decimal column and no Float column or number with a decimal point is a string, as TailorDB returns decimals as strings; `/` on integers drops the remainder. `SUM`, `AVG`, `MIN`, and `MAX` of Decimal values are strings too.

Date and datetime columns are typed as `Date` and time columns as `string`, or as `Temporal` values when `kyselyTypePlugin` is configured with `temporal: true`; time fields inside nested objects stay strings. Create the client with the same setting, `new tailordb.Client({ namespace, temporal: true })`, so the values it returns match the types.

## Limitations

- Functions that import `.sql` files cannot be loaded in Vitest yet.
- HTTP adapters, TailorDB hooks and validations, and migration scripts cannot import `.sql` files.
- While a `.sql` file has an error, `tsc` reports that error and not the type errors of other files.
