# Builtin Generators

The SDK includes four builtin generators for common code generation tasks.

## @tailor-platform/kysely-type

Generates Kysely type definitions and the `getDB()` function for type-safe database access.

### Configuration

```typescript
["@tailor-platform/kysely-type", { distPath: "./generated/tailordb.ts" }];
```

| Option     | Type     | Description                 |
| ---------- | -------- | --------------------------- |
| `distPath` | `string` | Output file path (required) |

### Output

Generates a TypeScript file containing:

- Type definitions for all TailorDB types
- `getDB(namespace)` function to create Kysely instances
- Utility types for `Timestamp`, `Serial`, and `ObjectColumnType` (wraps nested objects containing date/datetime fields to provide correct insert vs select types)

### Usage

```typescript
import { getDB } from "./generated/tailordb";

// In resolvers
body: async (context) => {
  const db = getDB("tailordb");
  const users = await db
    .selectFrom("User")
    .selectAll()
    .where("email", "=", context.input.email)
    .execute();
  return { users };
};

// In executors
body: async ({ newRecord }) => {
  const db = getDB("tailordb");
  await db.insertInto("AuditLog").values({ userId: newRecord.id, action: "created" }).execute();
};

// In workflow jobs
body: async (input, { env }) => {
  const db = getDB("tailordb");
  return await db
    .selectFrom("Order")
    .selectAll()
    .where("id", "=", input.orderId)
    .executeTakeFirst();
};
```

### Raw SQL

For queries that the Kysely query builder can't express, use the `sql` tag re-exported from `@tailor-platform/sdk/kysely`. Plain value substitutions (`${...}`) are sent as bound parameters, so user-supplied values are parameterized safely. SQL fragments produced by Kysely helpers (for example `sql.raw(...)`, identifiers, refs) are inlined into the generated SQL string by design — do not pass untrusted input through those.

```typescript
import { sql } from "@tailor-platform/sdk/kysely";
import { getDB } from "./generated/tailordb";

createResolver({
  name: "supplierCountByState",
  operation: "query",
  input: { country: t.string() },
  output: t.object({
    rows: t.array(t.object({ state: t.string(), count: t.int() })),
  }),
  body: async ({ input }) => {
    const db = getDB("tailordb");
    const { rows } = await sql<{ state: string; count: number }>`
      SELECT state, COUNT(*) AS count
        FROM "Supplier"
       WHERE country = ${input.country}
    GROUP BY state
    `.execute(db);
    return { rows };
  },
});
```

The same `sql` tag works inside `db.transaction().execute(async (trx) => ...)` by passing `trx` to `.execute()`:

```typescript
await db.transaction().execute(async (trx) => {
  await sql`UPDATE "Supplier" SET state = ${state} WHERE id = ${id}`.execute(trx);
});
```

## @tailor-platform/enum-constants

Extracts enum constants from TailorDB type definitions.

### Configuration

```typescript
["@tailor-platform/enum-constants", { distPath: "./generated/enums.ts" }];
```

| Option     | Type     | Description                 |
| ---------- | -------- | --------------------------- |
| `distPath` | `string` | Output file path (required) |

### Output

Generates TypeScript constants for all enum fields:

```typescript
// Generated output
export const OrderStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
```

### Usage

```typescript
import { OrderStatus } from "./generated/enums";

// Type-safe enum usage
const status: OrderStatus = OrderStatus.PENDING;

// In queries
const orders = await db
  .selectFrom("Order")
  .selectAll()
  .where("status", "=", OrderStatus.COMPLETED)
  .execute();
```

## @tailor-platform/file-utils

Generates utility functions for handling file-type fields in TailorDB.

### Configuration

```typescript
["@tailor-platform/file-utils", { distPath: "./generated/files.ts" }];
```

| Option     | Type     | Description                 |
| ---------- | -------- | --------------------------- |
| `distPath` | `string` | Output file path (required) |

### Output

Generates TypeScript interfaces and utilities for types with file fields:

```typescript
// Generated output
export interface UserFileFields {
  avatar: string;
  documents: string;
}

export function getUserFileFields(): (keyof UserFileFields)[] {
  return ["avatar", "documents"];
}
```

## @tailor-platform/seed

Generates seed data configuration files for database initialization.

### Configuration

```typescript
// Basic configuration
["@tailor-platform/seed", { distPath: "./seed" }];

// With default machine user
["@tailor-platform/seed", { distPath: "./seed", machineUserName: "admin" }];
```

| Option              | Type      | Description                                                                                                                                                       |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `distPath`          | `string`  | Output directory path (required)                                                                                                                                  |
| `machineUserName`   | `string`  | Default machine user name (can be overridden at runtime)                                                                                                          |
| `strictIdpUserSync` | `boolean` | Enforce that every userProfile row has a matching `_User` row during seed validation (default `true`). See [IdP user synchronization](#idp-user-synchronization). |

### IdP user synchronization

When `auth.userProfile` is configured, the seed plugin treats the userProfile
type (e.g. `User`) and the IdP-managed `_User` table as a pair. To help
`validate` catch mistakes such as creating an IdP credential without a
corresponding application user, the plugin always emits a foreign key from
`_User.name` to `<userProfile>.<usernameField>`.

By default (`strictIdpUserSync: true`) the plugin also emits the reverse
foreign key — from `<userProfile>.<usernameField>` to `_User.name` — so that a
userProfile row without a matching `_User` row is rejected as well. This is the
right default for seed data that is expected to keep both tables in lockstep.

The reverse direction is not enforced by the runtime: in production it is
normal to have a userProfile row whose IdP credential does not exist yet
(typical example: a user who has been invited but has not finished signing
up). To seed such states, set `strictIdpUserSync: false`:

```ts
seedPlugin({
  distPath: "./seed",
  machineUserName: "admin",
  strictIdpUserSync: false,
}),
```

With this option, only the `_User → userProfile` foreign key is generated, and
the `validate` command accepts userProfile rows that do not have a matching
`_User` row.

### Output

Generates a seed directory structure:

```
seed/
├── data/
│   ├── User.jsonl        # Seed data files (JSONL format)
│   ├── User.schema.ts    # lines-db schema definitions
│   └── Product.jsonl
└── exec.mjs              # Executable script
```

### Usage

Run the generated executable script:

```bash
# With machine user from config
node seed/exec.mjs

# Specify machine user at runtime (required if not configured, or to override)
node seed/exec.mjs --machine-user admin

# Short form
node seed/exec.mjs -m admin

# With other options
node seed/exec.mjs -m admin --truncate --yes
```

The `--machine-user` option is required at runtime if `machineUserName` is not configured in the generator options.

The generated files are compatible with gql-ingest for bulk data import.
