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

Compare a `uuid` column with a cast. A `string` variable is typed `text`, and PostgreSQL has no `uuid = text` operator, so the check reports `Invalid Query: operator does not exist: uuid = text`:

```typescript
sql`UPDATE "Invoice" SET "status" = ${status} WHERE "id" = ${id}::uuid`;
```

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

## Performance

Measured on this repository's `example/` project: 14 TailorDB tables in one namespace and 106 TypeScript files in `tsconfig.json`, plus 50 files that each contain three typical statements (a filter, a `JOIN`, a `LEFT JOIN`, an `INSERT ... RETURNING`, an `UPDATE`, an aggregate). Apple M3 (8 cores, 16 GB), macOS 26.6, Node.js 24.13.0, ESLint 10.11.0, SafeQL 5.4.1, `@typescript-eslint/parser` 8.71.0, TypeScript 6.0.3, PGlite 0.5.8. Every cell is the range of 3 to 5 runs with the median in parentheses; timings on a laptop vary from run to run.

### Whole `eslint` run

Wall time in seconds. "Parser" is the TypeScript parser without type information; "Type information" adds `projectService`, which any type-aware lint rule needs; "SafeQL" is the generated config.

| Files linted                      | Parser        | Type information | SafeQL         |
| --------------------------------- | ------------- | ---------------- | -------------- |
| 1 file with SQL                   | 0.3-1.5 (0.4) | 1.7-1.9 (1.7)    | 3.3-3.6 (3.4)  |
| 50 files with SQL                 | 0.4 (0.4)     | 1.7-1.8 (1.7)    | 3.8-6.9 (4.2)  |
| 106 project files, no SQL         | 0.6 (0.6)     | 1.9-3.0 (1.9)    | 2.3-3.6 (2.7)  |
| 500 generated files, no SQL       | 0.7-1.6 (0.9) | 2.3-4.0 (3.8)    | 3.8-6.6 (5.0)  |
| 106 project files and 50 with SQL | 0.6-1.6 (1.0) | 2.6-12.0 (4.8)   | 6.1-13.1 (7.5) |

- Type information costs about 1.3 s at startup in this project and grows with the number of files in your `tsconfig.json`. Point `files` at the files that contain SQL to avoid paying for the rest.
- SafeQL adds about 1.7 s the first time a file with SQL is checked: it starts an in-memory PostgreSQL, applies the schema, and analyzes the first statement. Linting files without SQL costs about 0.8 s more than type-aware linting alone.

### Per file, after startup

One process, files checked one after another:

| Step                                | Type information | SafeQL           |
| ----------------------------------- | ---------------- | ---------------- |
| First file in the process           | 1.6-2.6 s (1.8)  | 3.1-6.0 s (3.5)  |
| Each further file with 3 statements | 1-4 ms (2)       | 5-7 ms (6)       |
| 50 such files in one call           | 60-123 ms (70)   | 156-213 ms (178) |

SafeQL adds about 4 ms per file, or about 1.3 ms per statement.

### Schema size

Starting the in-memory PostgreSQL and applying the schema, 7 fresh processes each:

| Schema                 | Start PostgreSQL | Apply schema  | Connect  | Total            |
| ---------------------- | ---------------- | ------------- | -------- | ---------------- |
| 2 tables               | 0.85-2.4 s (1.0) | 3-20 ms (4)   | 12-19 ms | 0.86-2.5 s (1.0) |
| 14 tables (`example/`) | 0.93-2.3 s (1.3) | 16-37 ms (17) | 13-23 ms | 0.97-2.3 s (1.3) |

The size of the schema adds about 13 ms; the start of the in-memory PostgreSQL dominates and varies more from run to run than it differs between the two schemas.
