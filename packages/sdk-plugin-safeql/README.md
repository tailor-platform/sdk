# SafeQL Plugin

Check the raw SQL you write against your TailorDB tables, and get the type of each result row, with [SafeQL](https://safeql.dev/). A mistyped column, a parameter of the wrong type, or a `LEFT JOIN` column used without a null check is reported in your editor and in `eslint`, before the statement ever runs.

## Requirements

- ESLint 9 or later and TypeScript. SafeQL needs type information from the TypeScript compiler, which `oxlint` does not provide to its JavaScript plugins, so the check cannot run in `oxlint`. Keep using `oxlint` for the rest of your lint; add ESLint only for this check.
- [`@electric-sql/pglite`](https://pglite.dev/), which the check uses as an in-memory PostgreSQL.

## Installation

```sh
pnpm add -D @tailor-platform/sdk-plugin-safeql eslint @electric-sql/pglite
```

If ESLint stops with `Cannot find module 'typescript'` under pnpm's global virtual store (`enableGlobalVirtualStore`), SafeQL cannot see your TypeScript. Declare the dependency it forgot in `pnpm-workspace.yaml`:

```yaml
packageExtensions:
  "@ts-safeql/eslint-plugin":
    peerDependencies:
      typescript: "*"
```

## Setup

Register the plugin in `tailor.config.ts`:

```typescript
import { definePlugins } from "@tailor-platform/sdk";
import { safeqlPlugin } from "@tailor-platform/sdk-plugin-safeql/plugin";

export const plugins = definePlugins(safeqlPlugin());
```

Run `tailor generate`. It writes `generated/safeql/eslint.ts`, an ESLint config that contains the schema of your tables. It also creates `eslint.config.ts` when your project has no ESLint config file:

```typescript
import safeql from "./generated/safeql/eslint";

export default [...safeql];
```

If you already have an ESLint config file, `tailor generate` leaves it alone. Add the same two pieces to it yourself:

```typescript
import safeql from "./generated/safeql/eslint";

export default [
  // ...your existing config
  ...safeql,
];
```

Run `tailor generate` again whenever your tables change, as you do for the other generated files.

### Options

| Option             | Default                        | Description                                                                                |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `namespace`        | -                              | The TailorDB namespace to check against. Required when more than one namespace has tables. |
| `files`            | every `.ts` file               | The files to check. Narrow it to where you write SQL, for example `["resolvers/**/*.ts"]`. |
| `distPath`         | `./generated/safeql/eslint.ts` | Where to write the generated config.                                                       |
| `eslintConfigPath` | `./eslint.config.ts`           | Where to create an `eslint.config.ts` when no ESLint config file exists next to it.        |

Every file in `files` must be part of your `tsconfig.json`, because the check reads type information. A file outside it is reported as `Parsing error: ... was not found by the project service`; list only the files your `tsconfig.json` includes. Declaration files (`*.d.ts`), `eslint.config.*`, `node_modules`, and `dist` are never checked.

## Writing SQL

Tag a statement with `sql`. Interpolated values become query parameters; they are never spliced into the statement text.

```typescript
import { sql, type QueryExecutor } from "@tailor-platform/sdk-plugin-safeql";

export async function findAdmins(client: QueryExecutor, minimumAge: number) {
  return sql`
    SELECT "email", "role" FROM "Account" WHERE "age" >= ${minimumAge}
  `.execute(client);
}
```

SafeQL reports that the statement has no type annotation and offers a fix that fills in the row type:

```typescript
sql<{ email: string; role: "ADMIN" | "MEMBER" }>`...`;
```

`execute` accepts anything with a `queryObject(text, values)` method, such as a `tailordb.Client`, and resolves to the rows.

What the check reports:

| Problem                                        | Message                                                  |
| ---------------------------------------------- | -------------------------------------------------------- |
| A column or table that does not exist          | `Invalid Query: column "emali" does not exist`           |
| A parameter whose type does not fit the column | `Invalid Query: operator does not exist: integer > text` |
| A row type that does not match the statement   | an annotation error with the type it expects             |

Row types follow your tables: a column of an optional field is `T | null`, a column from the outer side of a `LEFT JOIN` is `T | null`, and an `enum` field with values is the union of those values.

### What is not checked

- Statements are checked against a PostgreSQL schema built from your tables, not against the Tailor Platform. SQL that PostgreSQL accepts but the platform does not, such as common table expressions, passes the check.
- A comparison with a string that is not one of an enum field's values (`WHERE "role" = 'OWNER'`) is not reported, because the platform stores enum values as text.
- `nested` fields are typed `any`. Tables whose names contain a `.` are typed from their columns without the enum values.

## Transactions

`transaction` runs statements between `BEGIN` and `COMMIT`, and rolls back when the callback throws or the commit fails.

```typescript
import { sql, transaction } from "@tailor-platform/sdk-plugin-safeql";

await transaction(client, async (tx) => {
  await sql`UPDATE "Account" SET "age" = ${30} WHERE "id" = ${id}`.execute(tx);
  await sql`INSERT INTO "AuditLog" ("action") VALUES (${"age-updated"})`.execute(tx);
});
```

Pass `{ isolation: "serializable" }` or `{ readOnly: true }` as the third argument to choose the isolation level or start a read-only transaction.

A client can have only one transaction open at a time, and transactions cannot be nested. Calling `transaction` on a client that already has one throws. The statements are ordinary `sql` statements, so the check works the same inside and outside a transaction.
