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

A `.sql` file holds one `SELECT`, `INSERT`, `UPDATE`, or `DELETE` statement in the SQL that TailorDB supports (see [Supported SQL queries](https://docs.tailor.tech/guides/function/accessing-tailordb#supported-sql-queries)). Anything outside it, such as a cast (`::`), a function other than `COUNT`, `SUM`, `AVG`, `MIN`, and `MAX`, a subquery, or `NULLS FIRST`, is an error at its place in the file.

- Name each parameter with a colon, as in `:status`. A parameter takes the type of the column it is compared with or written to, and a name can appear more than once.
- Table and column names are case-sensitive, as in TailorDB, whether or not you quote them.
- The tables of one query must belong to one TailorDB namespace. Tables of [external namespaces](../../configuration.md#external-resources) are not available.
- Columns of the result must have distinct names. Give same-named columns of joined tables different names with `AS`.

## Running Queries

Call `.run()` with a `tailordb.Client` for the query's namespace, `query.namespace`, or with a transaction created from one, and with the parameters when the query has any. It resolves to the rows, shaped by how many the query can return:

| The query                                                                                                           | `.run()` resolves to |
| ------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Matches `id`, a unique field, or a unique index of every table it reads, or has `LIMIT 1`                           | The row, or `null`   |
| Inserts one row with `RETURNING` and `ON CONFLICT ... DO NOTHING`, or `DO UPDATE ... WHERE`                         | The row, or `null`   |
| Aggregates without `GROUP BY`, `HAVING`, or `OFFSET`, or inserts one row with `RETURNING` and no such `ON CONFLICT` | The row              |
| Inserts, updates, or deletes without `RETURNING`                                                                    | Nothing              |
| Anything else                                                                                                       | An array of rows     |

A query matches a table's key when `WHERE` compares each column of the key with `=` to a value, or to a column of a table the query already matches, outside any `OR`. A join counts too: joining a table on its `id` to a matched table's column, as when you join an order's customer, matches the customer. The `ON` of a `LEFT JOIN` matches only the joined table, and that of a `RIGHT JOIN` or `FULL JOIN` matches no table.

A column is nullable when its field is optional or its table is outer-joined. A column that the statement's `WHERE` needs a value in is typed without `null`, except a column the `UPDATE` sets: one it compares, or tests with `IS NOT NULL`, `IN`, `BETWEEN`, or `LIKE`, outside any `OR`. That also proves the column's table has a row, so the required columns of an outer-joined table lose `null` too. With `GROUP BY`, `SUM`, `AVG`, `MIN`, and `MAX` of a column that is not nullable are not nullable either, as every group has a row.

Date and datetime columns are typed as `Date` and time columns as `string`, or as `Temporal` values when `kyselyTypePlugin` is configured with `temporal: true`; time fields inside nested objects stay strings. Create the client with the same setting, `new tailordb.Client({ namespace, temporal: true })`, so the values it returns match the types.

## Limitations

- Functions that import `.sql` files cannot be loaded in Vitest yet.
- HTTP adapters, TailorDB hooks and validations, and migration scripts cannot import `.sql` files.
- While a `.sql` file has an error, `tsc` reports that error and not the type errors of other files.
