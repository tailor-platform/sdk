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

| Option               | Type                                           | Description                                                                                                                                                       |
| -------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `distPath`           | `string`                                       | Output directory path (required)                                                                                                                                  |
| `machineUserName`    | `string`                                       | Default machine user name (can be overridden at runtime)                                                                                                          |
| `disableIdpUserSync` | `{ userToIdp?: boolean; idpToUser?: boolean }` | Skip emitting individual `_User <-> userProfile` foreign keys. Both directions are emitted by default. See [IdP user synchronization](#idp-user-synchronization). |

### IdP user synchronization

When `auth.userProfile` is configured, the seed plugin treats the userProfile
type (e.g. `User`) and the IdP-managed `_User` table as a pair. By default it
emits foreign keys in both directions so that `validate` rejects any row in
either table that does not have a matching counterpart:

| Direction   | Foreign key                                    | Catches                                        |
| ----------- | ---------------------------------------------- | ---------------------------------------------- |
| `idpToUser` | `_User.name` → `<userProfile>.<usernameField>` | Creating an IdP credential with no profile row |
| `userToIdp` | `<userProfile>.<usernameField>` → `_User.name` | Creating a profile row with no IdP credential  |

Neither direction is enforced by the runtime. In production it is normal for
one side to exist without the other — for example a userProfile row exists
the moment a user is invited, but the corresponding `_User` row appears only
after the user finishes signing up. To seed such states, set the relevant
direction in `disableIdpUserSync` to `true`:

```typescript
// Allow seeding invited-but-not-registered userProfile rows.
// Still rejects _User rows without a matching userProfile row.
["@tailor-platform/seed", { distPath: "./seed", disableIdpUserSync: { userToIdp: true } }];

// Allow seeding _User rows whose userProfile does not exist yet.
// Still rejects userProfile rows without a matching _User row.
["@tailor-platform/seed", { distPath: "./seed", disableIdpUserSync: { idpToUser: true } }];
```

Omitted directions default to `false` (FK emitted).

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

The `exec.mjs` is fully regenerated on every `sdk generate` and starts with an `@generated` header — do not hand-edit it. Its `--truncate` path reuses the `tailordb truncate` command, so namespaces declared with `{ external: true }` are skipped automatically and a shell app cannot wipe a sibling app's data via `seed:reset`.
