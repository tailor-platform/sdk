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

### Prerequisites

Install the required dev dependency for type definitions:

```bash
pnpm add -D @tailor-platform/function-types
```

### Output

Generates a TypeScript file containing:

- Type definitions for all TailorDB types
- `getDB(namespace)` function to create Kysely instances
- Utility types for Timestamp and Serial fields

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

| Option            | Type     | Description                                              |
| ----------------- | -------- | -------------------------------------------------------- |
| `distPath`        | `string` | Output directory path (required)                         |
| `machineUserName` | `string` | Default machine user name (can be overridden at runtime) |

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
