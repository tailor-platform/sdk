# [Tailor SDK](https://github.com/tailor-platform/tailor-sdk/pkgs/npm/tailor-sdk)

A development kit for building applications on the Tailor Platform.

## Table of Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [TailorDB](#tailordb)
  - [Defining Models](#defining-models)
  - [Field Types](#field-types)
  - [Plural Forms](#plural-forms)
  - [Timestamps and Common Fields](#timestamps-and-common-fields)
  - [Nested Objects](#nested-objects)
  - [Reusable Field Definitions](#reusable-field-definitions)
  - [Type Inference](#type-inference)
- [Pipeline Resolvers](#pipeline-resolvers)
  - [Creating Resolvers](#creating-resolvers)
  - [Step Types](#step-types)
  - [Processing Flow Patterns](#processing-flow-patterns)
  - [Kysely Integration](#kysely-integration)
- [Executor](#executor)
  - [Overview](#overview)
  - [Basic Usage](#basic-usage)
  - [Advanced Features](#advanced-features)
- [Generators](#generators)
- [CLI Commands](#cli-commands)

## Installation

### Quick Start with Init Command

The easiest way to start a new Tailor SDK project is using the init command:

```bash
npx @tailor-platform/tailor-sdk init my-project
```

This will create a new project with all necessary configuration files and example code.

#### Init Command Options

```bash
npx @tailor-platform/tailor-sdk init [project-name] [options]
```

Options:

- `-r, --region <region>` - Deployment region (asia-northeast | us-west, default: asia-northeast)
- `--skip-install` - Skip npm install after project creation
- `-t, --template <template>` - Project template (basic | fullstack, default: basic)
- `-y, --yes` - Skip interactive prompts and use default values
- `--add-to-existing` - Add Tailor SDK to an existing TypeScript project

Templates:

- **basic** - Minimal setup with TailorDB and simple resolvers
- **fullstack** - Full setup including authentication configuration

#### Adding to Existing Projects

The init command can add Tailor SDK to your existing TypeScript projects:

1. **Using the --add-to-existing flag**:

   ```bash
   cd your-existing-project
   npx @tailor-platform/tailor-sdk init --add-to-existing
   ```

2. **Interactive mode**:

   ```bash
   # When running init in a directory with package.json
   npx @tailor-platform/tailor-sdk init
   # Choose "Add Tailor SDK to existing project" when prompted
   ```

3. **Specify existing project directory**:
   ```bash
   npx @tailor-platform/tailor-sdk init existing-project-name
   # Choose "Add Tailor SDK to existing project" when prompted
   ```

When adding to an existing project, the init command will:

- Add `@tailor-platform/tailor-sdk` to your dependencies
- Add Tailor scripts (`tailor:dev`, `tailor:build`, `tailor:deploy`) to package.json
- Create `tailor.config.ts` with your project configuration
- Create `src/tailordb/` and `src/resolvers/` directories with examples
- Update `.gitignore` to exclude generated files

Existing files are never overwritten - the command safely skips any files that already exist.

### Manual Installation

```bash
npm install @tailor-platform/tailor-sdk
# or
yarn add @tailor-platform/tailor-sdk
# or
pnpm add @tailor-platform/tailor-sdk
```

## Getting Started

Create a `tailor.config.ts` file in your project root:

```typescript
import { defineConfig } from "@tailor-platform/tailor-sdk";

export default defineConfig({
  name: "my-project",
  region: "asia-northeast",
  app: {
    "my-app": {
      db: { "my-db": { files: ["./src/tailordb/*.ts"] } },
      pipeline: {
        "my-pipeline": { files: ["./src/resolvers/**/resolver.ts"] },
      },
      auth: {
        namespace: "my-auth",
        idProviderConfigs: [
          {
            Name: "sample",
            Config: {
              Kind: "IDToken",
              ClientID: "exampleco",
              ProviderURL: "https://exampleco-enterprises.auth0.com/",
            },
          },
        ],
        userProfileProvider: "TAILORDB",
        userProfileProviderConfig: {
          Kind: "TAILORDB",
          Namespace: "my-db",
          Type: "User",
          UsernameField: "email",
          AttributesFields: ["roles"],
        },
        machineUsers: [
          {
            Name: "admin-machine-user",
            Attributes: ["4293a799-4398-55e6-a19a-fe8427d1a415"],
          },
        ],
        oauth2Clients: [],
      },
    },
  },
  executor: { files: ["./src/executors/*.ts"] },
});
```

This configuration file defines:

- Your project name and deployment region
- Applications with their services (databases and resolvers)
- File patterns for discovering your TailorDB models and resolvers

## Configuration

The `defineConfig` function accepts the following options:

```typescript
defineConfig({
  name: string,              // Your project name
  region: string,           // Deployment region
  app: {
    [appName: string]: {
      db?: {                // TailorDB services
        [namespace: string]: {
          files: string[]   // Glob patterns for type files
        }
      },
      pipeline?: {          // Pipeline services
        [namespace: string]: {
          files: string[]   // Glob patterns for resolver files
        }
      },
      auth?: {              // Authentication configuration
        namespace: string,
        idProviderConfigs: [...],
        userProfileProvider: string,
        // ... other auth settings
      }
    }
  },
  executor: { files: string[] },
  generators?: [            // Code generators
    "@tailor/sdl",
    ["@tailor/kysely-type", { distPath: ({ tailorDB }) => `./src/resolvers/${tailorDB}.ts` }],
    ["@tailor/db-type", { distPath: () => `./src/tailordb/types.ts` }],
  ],
})
```

## TailorDB

TailorDB provides a type-safe way to define your data models using TypeScript.

### Defining Models

Create model files in your TailorDB directory (e.g., `src/tailordb/`):

```typescript
import { db, t } from "@tailor-platform/tailor-sdk";

// Define a simple model
export const product = db.type("Product", {
  name: db.string(), // Required by default
  description: db.string().optional(), // Optional field
  price: db.int(), // Required integer
  weight: db.float().optional(), // Optional float
  inStock: db
    .bool()
    .hooks({
      create: ({ value }) => value ?? false,
    })
    .optional({ assertNonNull: true }), // non-null assertion with create hook
  category: db.enum("electronics", "clothing", "food"), // Enum field
  tags: db.string().array(), // Array of strings
  ...db.fields.timestamps(), // Add createdAt and updatedAt
});

// Export type for TypeScript usage
export type Product = t.infer<typeof product>;
```

### Field Types

TailorDB supports the following field types:

| Method          | TypeScript Type | Database Type |
| --------------- | --------------- | ------------- |
| `db.string()`   | string          | String        |
| `db.int()`      | number          | Integer       |
| `db.float()`    | number          | Float         |
| `db.bool()`     | boolean         | Boolean       |
| `db.date()`     | Date            | Date          |
| `db.datetime()` | Date            | DateTime      |
| `db.uuid()`     | string          | UUID          |
| `db.enum()`     | string          | Enum          |
| `db.object()`   | object          | Nested Object |

Each field type supports modifiers:

```typescript
// Basic field with modifiers
db.string()
  .optional() // Field can be null
  .optional({ assertNonNull: true }) // Optional but non-null at runtime
  .description("Field description") // Add description
  .unique() // Values must be unique
  .index() // Create database index
  .array() // Array of values
  .values(["A", "B", "C"]); // Allowed values constraint

// Relations
db.uuid().relation({
  type: "1-n", // or "1-1", "oneToMany", "oneToOne"
  toward: { type: customer },
  backward: "orders", // Optional: reverse relation name
});

// Validation
db.string().validate(
  ({ value }) => value.length > 0,
  ({ value }) => value.length < 100,
);

// Hooks for computed fields
db.string().hooks({
  create: ({ data, user }) => computeValue(data),
  update: ({ data, user }) => computeValue(data),
});
```

### Plural Forms

When defining models, you can specify a custom plural form for better GraphQL query naming:

```typescript
// Default pluralization (User -> Users)
export const person = db.type("User", {
  name: db.string(),
  age: db.int().optional(),
});

// Custom plural form (User -> UserList)
export const person = db.type(["User", "UserList"], {
  name: db.string(),
  age: db.int().optional(),
});
```

When using the tuple syntax `[singular, plural]`:

- The first element is the singular form (model name)
- The second element is the plural form used in GraphQL queries

```gql
query {
  # Use `userList` instead of `users` to fetch records
  userList {
    edges {
      node {
        name
      }
    }
  }
}
```

For more details, please [refer to the documentation](https://docs.tailor.tech/guides/tailordb/advanced-settings/uncountable-nouns).

### Timestamps and Common Fields

Add timestamp fields using the built-in helper:

```typescript
export const user = db.type("User", {
  email: db.string().unique(), // Required and unique
  name: db.string().optional(), // Optional field
  role: db.string().values(["admin", "user", "guest"]), // With allowed values
  ...db.fields.timestamps(), // Adds createdAt and updatedAt
});
```

### Nested Objects

TailorDB supports deeply nested object structures:

```typescript
export const nestedProfile = db.type("NestedProfile", {
  userInfo: db.object({
    personal: db.object({
      name: db.string(),
      age: db.int().optional(),
      bio: db.string().optional(),
    }),
    contact: db.object({
      email: db.string(),
      phone: db.string().optional(),
      address: db.object({
        street: db.string(),
        city: db.string(),
        country: db.string(),
        coordinates: db
          .object({
            latitude: db.float(),
            longitude: db.float(),
          })
          .optional(),
      }),
    }),
    preferences: db
      .object({
        notifications: db.object({
          email: db.bool(),
          sms: db.bool(),
          push: db.bool(),
        }),
        privacy: db
          .object({
            profileVisible: db.bool(),
            dataSharing: db.bool(),
          })
          .optional(),
      })
      .optional(),
  }),
  metadata: db.object({
    created: db.datetime(),
    lastUpdated: db.datetime().optional(),
    version: db.int(),
  }),
});
```

### Reusable Field Definitions

You can extract common field definitions for reuse across models:

```typescript
// Define reusable field structure
export const attachedFiles = db
  .object({
    id: db.uuid(),
    name: db.string(),
    size: db.int().validate(({ value }) => value > 0),
    type: db.enum("text", "image", "pdf", "video"),
  })
  .array();

// Use in multiple models
export const purchaseOrder = db.type("PurchaseOrder", {
  supplierID: db.uuid().relation({
    type: "1-n",
    toward: { type: supplier },
  }),
  totalPrice: db.int(),
  attachedFiles, // Reuse the field definition
  ...db.fields.timestamps(),
});

export const invoice = db.type("Invoice", {
  invoiceNumber: db.string(),
  attachedFiles, // Same field structure
  ...db.fields.timestamps(),
});
```

### Type Inference

Use TypeScript's type inference to get compile-time type safety:

```typescript
// Define the model with relations and validations
export const order = db.type("Order", {
  orderNumber: db.string().unique(),
  customerId: db.uuid().relation({
    type: "1-n",
    toward: { type: customer, as: "customer" },
    backward: "orders",
  }),
  totalAmount: db.float().validate(({ value }) => value >= 0),
  status: db
    .string()
    .values(["pending", "processing", "completed", "cancelled"]),
  items: db
    .object({
      productId: db.uuid(),
      quantity: db.int(),
      price: db.float(),
    })
    .array(),
  ...db.fields.timestamps(),
});

// Infer the TypeScript type
export type Order = t.infer<typeof order>;

// Now you can use Order as a TypeScript type
function processOrder(order: Order) {
  console.log(order.orderNumber); // Type-safe access
  console.log(order.customer); // Related customer data
}
```

## Pipeline Resolvers

Pipeline Resolvers allow you to create GraphQL resolvers with multiple processing steps.

### Creating Resolvers

Create resolver files in your resolver directory (e.g., `src/resolvers/`):

```typescript
import {
  createQueryResolver,
  createMutationResolver,
  t,
} from "@tailor-platform/tailor-sdk";

// Query resolver
export default createQueryResolver(
  "getUser",
  t.type({
    id: t.string(),
  }),
  { defaults: { dbNamespace: "my-db" } },
)
  .fnStep("fetchUser", async (context) => {
    // Access input via context.input
    const userId = context.input.id;
    // Your logic here
    return { id: userId, name: "John Doe" };
  })
  .returns(
    (context) => ({
      user: context.fetchUser,
    }),
    t.type({
      user: t.object({
        id: t.string(),
        name: t.string(),
      }),
    }),
  );

// Mutation resolver
export default createMutationResolver(
  "createOrder",
  t.type({
    items: t.array(
      t.object({
        productId: t.string(),
        quantity: t.integer(),
      }),
    ),
  }),
)
  .fnStep("validateItems", async (context) => {
    // Validation logic
    return context.input.items;
  })
  .fnStep("createOrder", async (context) => {
    // Create order logic
    return { orderId: "123", items: context.validateItems };
  })
  .returns(
    (context) => ({
      order: context.createOrder,
    }),
    t.type({
      order: t.object({
        orderId: t.string(),
        items: t.array(t.any()),
      }),
    }),
  );
```

### Step Types

Resolvers support different types of steps:

#### Function Steps

Execute TypeScript functions:

```typescript
.fnStep("stepName", async (context) => {
  // Access previous steps via context
  // Access input via context.input
  return result;
})
```

#### SQL Steps

Execute SQL queries:

```typescript
.sqlStep("queryUsers", async (context) => {
  const result = await context.client.exec<{ name: string }>(
    /* sql */ `SELECT name FROM User WHERE active = true`
  );
  return result;
})
```

#### Kysely Steps (Type-safe SQL)

Use Kysely for type-safe SQL queries:

```typescript
import { kyselyWrapper } from "./db";

.sqlStep("getSuppliers", (context) =>
  kyselyWrapper(context, async (context) => {
    const suppliers = await context.db
      .selectFrom("Supplier")
      .select(["id", "name", "state"])
      .where("active", "=", true)
      .execute();

    return suppliers;
  })
)
```

### Processing Flow Patterns

#### Complex Multi-Step Resolver Example

Here's a comprehensive example combining different step types:

```typescript
import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";
import { format } from "date-fns";
import { kyselyWrapper } from "./db";

export default createQueryResolver(
  "complexWorkflow",
  t.type({
    userId: t.string(),
    filters: t.object({
      status: t.string().optional(),
      dateFrom: t.datetime().optional(),
    }),
  }),
  { defaults: { dbNamespace: "my-db" } },
)
  // Step 1: Validate and transform input
  .fnStep("validateInput", (context) => {
    if (!context.input.userId) {
      throw new Error("User ID is required");
    }
    return {
      userId: context.input.userId,
      status: context.input.filters.status || "active",
    };
  })

  // Step 2: Execute raw SQL with safe parameterization
  .sqlStep("getUserData", async (context) => {
    // Using sqlstring for safe query building
    const sql = require("sqlstring");
    const query = sql.format(
      /* sql */ `SELECT * FROM User WHERE id = ? AND status = ?`,
      [context.validateInput.userId, context.validateInput.status],
    );
    return await context.client.execOne<{ id: string; name: string }>(query);
  })

  // Step 3: Use Kysely within sqlStep for type-safe query building
  .sqlStep("getRelatedData", (context) =>
    kyselyWrapper(context, async (ctx) => {
      const orders = await ctx.db
        .selectFrom("Order")
        .leftJoin("Product", "Order.productId", "Product.id")
        .select([
          "Order.id",
          "Order.totalAmount",
          "Product.name as productName",
        ])
        .where("Order.userId", "=", context.getUserData.id)
        .where(
          "Order.createdAt",
          ">=",
          context.input.filters.dateFrom || new Date(0),
        )
        .orderBy("Order.createdAt", "desc")
        .limit(10)
        .execute();

      return orders;
    }),
  )

  // Step 4: Process and format results
  .fnStep("formatResults", (context) => {
    return {
      user: context.getUserData,
      orders: context.getRelatedData.map((order) => ({
        ...order,
        formattedDate: format(order.createdAt, "yyyy-MM-dd"),
      })),
      summary: {
        totalOrders: context.getRelatedData.length,
        totalAmount: context.getRelatedData.reduce(
          (sum, order) => sum + order.totalAmount,
          0,
        ),
      },
    };
  })

  .returns(
    (context) => context.formatResults,
    t.type({
      user: t.object({
        id: t.string(),
        name: t.string(),
      }),
      orders: t.array(
        t.object({
          id: t.string(),
          totalAmount: t.number(),
          productName: t.string(),
          formattedDate: t.string(),
        }),
      ),
      summary: t.object({
        totalOrders: t.integer(),
        totalAmount: t.number(),
      }),
    }),
  );
```

### Kysely Integration

The SDK provides a `kyselyWrapper` helper for type-safe SQL queries:

```typescript
// In your database configuration file (e.g., src/tailordb.ts)
import { SqlClient } from "@tailor-platform/tailor-sdk";
import { Kysely, PostgresAdapter, DummyDriver } from "kysely";

// Define your database types (usually auto-generated)
interface DB {
  User: {
    id: string;
    name: string;
    email: string;
  };
  // ... other tables
}

// Kysely wrapper implementation
export async function kyselyWrapper<C extends { client: SqlClient }, R>(
  context: C,
  callback: (context: C & { db: Kysely<DB> }) => Promise<R>
) {
  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  const clientWrapper = {
    exec: async (query: CompiledQuery) => {
      return await context.client.exec(query.sql);
    },
  };

  return await callback({ ...context, db, client: clientWrapper });
}

// Usage in resolvers
.sqlStep("complexQuery", (context) =>
  kyselyWrapper(context, async (ctx) => {
    return await ctx.db
      .selectFrom("User")
      .innerJoin("UserSetting", "User.id", "UserSetting.userId")
      .select(["User.name", "User.email", "UserSetting.language"])
      .where("UserSetting.language", "=", "en")
      .execute();
  })
)
```

## Executor

### Overview

Executors are event-driven workflows that respond to database events, schedules, or external triggers. They enable you to build reactive systems that automatically execute code or call webhooks when specific conditions are met.

### Configuration

Add executor configuration to your `tailor.config.ts`:

```typescript
export default defineConfig({
  // ... other config
  executor: { files: ["./src/executors/*.ts"] },
});
```

### Creating Executors

Create executor files in your executor directory (e.g., `src/executors/`):

```typescript
import {
  createExecutor,
  recordCreatedTrigger,
} from "@tailor-platform/tailor-sdk";
import { user } from "../tailordb/user";

export default createExecutor(
  "user-welcome", // Unique identifier
  "Send welcome email to new users", // Description
)
  .on(
    // Trigger (see Trigger Types section)
    recordCreatedTrigger(
      user,
      ({ newRecord }) => newRecord.email && newRecord.isActive,
    ),
  )
  .executeFunction(
    // Execution method (see Execution Methods section)
    async ({ newRecord, client }) => {
      // Send welcome email logic here
      console.log(`Sending welcome email to ${newRecord.email}`);
    },
    { dbNamespace: "my-db" },
  );
```

Executors follow a simple pattern:

1. **Create** an executor with `createExecutor(name, description)`
2. **Define trigger** with `.on()` method
3. **Specify execution** with `.executeFunction()`, `.executeWebhook()`, or `.executeGql()`

### Trigger Types

#### Record Triggers

- `recordCreatedTrigger(type, filter?)` - Fires when a new record is created
- `recordUpdatedTrigger(type, filter?)` - Fires when a record is updated
- `recordDeletedTrigger(type, filter?)` - Fires when a record is deleted

Each trigger can include an optional filter function:

```typescript
recordUpdatedTrigger(
  order,
  ({ newRecord, oldRecord }) =>
    newRecord.status === "completed" && oldRecord.status !== "completed",
);
```

#### Schedule Triggers

- `scheduleTrigger(cron)` - Fires on a cron schedule

Use cron expressions for scheduled execution:

```typescript
scheduleTrigger("*/5 * * * *"); // Every 5 minutes
scheduleTrigger("0 9 * * 1"); // Every Monday at 9 AM
scheduleTrigger("0 0 1 * *"); // First day of every month
```

#### Incoming Webhook Triggers

- `incomingWebhookTrigger<T>()` - Fires when an external webhook is received

Use typed payloads for type safety:

```typescript
incomingWebhookTrigger<WebhookPayload>();
```

#### Resolver Executed Triggers

- `resolverExecutedTrigger(resolver, filter?)` - Fires when a pipeline resolver is executed

Filter based on execution results:

```typescript
resolverExecutedTrigger(
  createOrderResolver,
  ({ result, error }) => !error && result?.order?.id, // Only trigger on successful executions
);
```

### Execution

Executors support different execution methods depending on your use case:

#### executeFunction

Execute JavaScript/TypeScript functions directly:

```typescript
import sqlstring from "sqlstring";

...
.executeFunction(
  async ({ newRecord, oldRecord, client }) => {
    const query = sqlstring.format(
      /* sql */ `SELECT * FROM Orders WHERE customerId = ?`,
      [newRecord.id]
    );
    const result = await client.exec(query);
    console.log(`Found ${result.length} orders for customer`);
  },
  { dbNamespace: "my-db" } // Optional configuration
)
```

#### executeWebhook

Call external webhooks with dynamic data:

```typescript
...
.executeWebhook({
  url: ({ newRecord }) => `https://api.example.com/webhooks/${newRecord.type}`,
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": { vault: "api-keys", key: "external-api" }, // Vault integration
  },
  body: ({ newRecord }) => ({
    id: newRecord.id,
    timestamp: new Date().toISOString(),
    data: newRecord,
  }),
})
```

#### executeGql

Execute GraphQL queries and mutations:

```typescript
...
.executeGql({
  appName: "my-app",
  query: gql`
    mutation UpdateUserStatus($id: ID!, $status: String!) {
      updateUser(id: $id, input: { status: $status }) {
        id
        status
        updatedAt
      }
    }
  `,
  variables: ({ newRecord }) => ({
    id: newRecord.userId,
    status: "active",
  }),
})
```

### Execution Context

The execution context varies based on the trigger type:

#### Record Trigger Context

For `recordCreatedTrigger`, `recordUpdatedTrigger`, and `recordDeletedTrigger`:

- `newRecord` - The new record state (not available for delete triggers)
- `oldRecord` - The previous record state (only for update triggers)
- `client` - Database client with methods:
  - `exec<T>(sql: string)` - Execute SQL and return array of results
  - `execOne<T>(sql: string)` - Execute SQL and return single result

#### Schedule Trigger Context

For `scheduleTrigger`:

- `client` - Database client with methods:
  - `exec<T>(sql: string)` - Execute SQL and return array of results
  - `execOne<T>(sql: string)` - Execute SQL and return single result

#### Incoming Webhook Trigger Context

For `incomingWebhookTrigger`:

- `payload` - The webhook request body (typed according to your generic parameter)
- `headers` - The webhook request headers
- `client` - Database client with methods:
  - `exec<T>(sql: string)` - Execute SQL and return array of results
  - `execOne<T>(sql: string)` - Execute SQL and return single result

#### Resolver Executed Trigger Context

For `resolverExecutedTrigger`:

- `result` - The resolver's return value (when execution succeeds)
- `error` - The error object (when execution fails)
- `input` - The input that was passed to the resolver
- `client` - Database client with methods:
  - `exec<T>(sql: string)` - Execute SQL and return array of results
  - `execOne<T>(sql: string)` - Execute SQL and return single result

### Advanced Features

#### Conditional Execution

Use filters to control when executors run:

```typescript
.on(
  recordUpdatedTrigger(product, ({ newRecord, oldRecord }) => {
    // Only trigger if price decreased by more than 10%
    return newRecord.price < oldRecord.price * 0.9;
  })
)
```

#### Vault Integration

Securely access secrets for webhook authentication:

```typescript
.executeWebhook({
  headers: {
    "X-API-Key": { vault: "external-apis", key: "partner-api-key" },
  },
})
```

#### Error Handling

Executors include built-in error handling and retry logic. Failed executions are logged and can be monitored through the Tailor console.

## Generators

The SDK includes built-in code generators that run automatically:

- **@tailor/sdl**: Generates GraphQL SDL files
- **@tailor/kysely-type**: Generates TypeScript types for Kysely queries
- **@tailor/manifest**: Generates deployment manifests

Configure generators in your `tailor.config.ts`:

```typescript
export default defineConfig({
  // ... other config
  generators: [
    "@tailor/sdl",
    ["@tailor/kysely-type", { distPath: "./src/generated/db.ts" }],
  ],
});
```

## CLI Commands

The SDK provides CLI commands for development:

```bash
# Initialize a new project
npx tailor-sdk init [project-name]

# Generate code and manifests
npx tailor-sdk generate

# Watch mode - regenerate on file changes
npx tailor-sdk generate --watch

# Deploy to Tailor Platform
npx tailor-sdk apply

# Deploy with custom manifest
npx tailor-sdk apply --manifest ./custom-manifest.cue
```

### Environment Variables

Set these environment variables for deployment:

```bash
TAILOR_ACCESS_TOKEN=<your personal access token>
```
