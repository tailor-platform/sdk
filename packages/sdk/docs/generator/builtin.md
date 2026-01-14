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

Install the required runtime dependencies:

```bash
pnpm add -D @tailor-platform/function-kysely-tailordb @tailor-platform/function-types
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
["@tailor-platform/seed", { distPath: "./seed" }][
  // With executable script
  ("@tailor-platform/seed", { distPath: "./seed", machineUserName: "admin" })
];
```

| Option            | Type     | Description                                        |
| ----------------- | -------- | -------------------------------------------------- |
| `distPath`        | `string` | Output directory path (required)                   |
| `machineUserName` | `string` | Machine user name for executable script (optional) |

### Output

Generates a seed directory structure:

```
seed/
├── config.yaml           # Entity dependencies configuration
├── data/
│   ├── User.jsonl        # Seed data files (JSONL format)
│   └── Product.jsonl
├── graphql/
│   ├── User.graphql      # GraphQL mutation files
│   └── Product.graphql
├── mapping/
│   ├── User.yaml         # GraphQL Ingest mapping files
│   └── Product.yaml
├── schema.ts             # lines-db schema definitions
└── exec.mjs              # Executable script (if machineUserName provided)
```

### Usage

If `machineUserName` is provided, an executable script is generated:

```bash
# Run seed data import
node seed/exec.mjs
```

The generated files are compatible with gql-ingest for bulk data import.
