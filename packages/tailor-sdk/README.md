# Tailor SDK

Development kit for building applications on the Tailor Platform.

## Table of Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [TailorDB](#tailordb)
  - [Defining Models](#defining-models)
  - [Field Types](#field-types)
  - [Plural Forms](#plural-forms)
  - [Timestamps and common fields](#timestamps-and-common-fields)
  - [Nested objects](#nested-objects)
  - [Reusable field definitions](#reusable-field-definitions)
  - [Type inference](#type-inference)
- [Pipeline Resolvers](#pipeline-resolvers)
  - [Creating Resolvers](#creating-resolvers)
  - [Step Types](#step-types)
  - [Processing Flow Patterns](#processing-flow-patterns)
- [Executor](#executor)
  - [Overview](#overview)
  - [Creating Executors](#creating-executors)
  - [Trigger Types](#trigger-types)
  - [Execution](#execution)
  - [Execution Context](#execution-context)
  - [Advanced Features](#advanced-features)
- [Generators](#generators)
- [CLI Commands](#cli-commands)
  - [Environment Variables](#environment-variables)

## Installation

### Quick Start with `init`

The easiest way to start a new Tailor SDK project is using the init command:

```bash
npx @tailor-platform/tailor-sdk init my-project
```

This will create a new project with all necessary configuration files and example code.

#### Init Options

```bash
npx @tailor-platform/tailor-sdk init [project-name] [options]
```

Options:

- `-r, --region <region>` Deployment region (`asia-northeast` | `us-west`, default: `asia-northeast`)
- `--skip-install` Skip npm install after project creation
- `-t, --template <tpl>` Template (`basic` | `fullstack`, default: `basic`)
- `-y, --yes` Skip prompts and use defaults
- `--add-to-existing` Add Tailor SDK to an existing TypeScript project
- `-s, --src-dir <dir>` Source directory name (default: `src`)

Templates:

- basic: minimal setup with TailorDB and a sample resolver
- fullstack: includes sample Auth configuration and TailorDB `User` type

#### Adding to existing projects

The `init` command can add Tailor SDK to an existing TypeScript project:

1. Use the flag:

   ```bash
   cd your-existing-project
   npx @tailor-platform/tailor-sdk init --add-to-existing
   ```

2. Interactive mode:

   ```bash
   # Run in a directory with package.json
   npx @tailor-platform/tailor-sdk init
   # Choose "Add Tailor SDK to existing project" when prompted
   ```

3. Specify a directory:
   npx @tailor-platform/tailor-sdk init existing-project-name
   # Choose "Add Tailor SDK to existing project" when prompted

When adding to an existing project, `init` will:

- add `@tailor-platform/tailor-sdk` to `devDependencies`
- add scripts to package.json: `tailor:dev`, `tailor:build`, `tailor:deploy`
- create `tailor.config.ts`
- create `src/tailordb/` and `src/resolvers/` with examples
- update `.gitignore` for generated outputs

Existing files are not overwritten — existing files are skipped safely.

### Manual installation

```bash
npm install -D @tailor-platform/tailor-sdk
# or
yarn add -D @tailor-platform/tailor-sdk
# or
pnpm add -D @tailor-platform/tailor-sdk
```

## Getting Started

Create a `tailor.config.ts` file in your project root:

```typescript
import { defineConfig } from "@tailor-platform/tailor-sdk";

export default defineConfig({
  // Choose one of the following identifiers.
  // id: "ws-xxxxxxxx",        // If you already know the workspace id
  name: "my-project", // Otherwise use name + region
  region: "asia-northeast",

  app: {
    "my-app": {
      db: {
        "my-db": { files: ["./src/tailordb/**/*.ts"] },
      },
      pipeline: {
        "my-pipeline": { files: ["./src/resolvers/**/resolver.ts"] },
      },
      // Optional Identity Provider and Auth services (fullstack template adds examples)
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
          { Name: "admin-machine-user", Attributes: ["role-uuid"] },
        ],
        oauth2Clients: [],
      },
    },
  },

  // Executors are configured at workspace level
  executor: { files: ["./src/executors/*.ts"] },

  // Optional: code generators
  generators: [
    [
      "@tailor/kysely-type",
      { distPath: ({ tailorDB }) => `./src/generated/${tailorDB}.ts` },
    ],
    [
      "@tailor/db-type",
      { distPath: ({ tailorDB }) => `./src/tailordb/${tailorDB}.types.ts` },
    ],
  ],
});
```

This configuration file defines:

- Workspace identifier (either `id` or `name`+`region`)
- Applications with their services (TailorDB, pipeline, optional IdP/Auth)
- File patterns for TailorDB models / pipeline resolvers / executors
- Optional code generators

## Configuration

The `defineConfig` function accepts the following options:

```typescript
defineConfig({
  // One of:
  // id: string,
  // or
  name: string,
  region: "asia-northeast" | "us-west",

  app: {
    [appName: string]: {
      cors?: string[];
      allowedIPAddresses?: string[];
      disableIntrospection?: boolean;

      db?: {
        [namespace: string]: { files: string[] };
      };
      pipeline?: {
        [namespace: string]: { files: string[] };
      };
      idp?: { [namespace: string]: { authorization: "insecure" | "loggedIn"; clients: string[] } };
      auth?: {
        namespace: string;
        idProviderConfigs?: Array<{
          Name: string;
          Config:
            | { Kind: "OIDC"; ClientID: string; ClientSecret: { VaultName: string; SecretKey: string }; ProviderURL: string; IssuerURL?: string; UsernameClaim?: string }
            | { Kind: "SAML"; MetadataURL: string; SpCertBase64: { VaultName: string; SecretKey: string }; SpKeyBase64: { VaultName: string; SecretKey: string } }
            | { Kind: "IDToken"; ProviderURL: string; IssuerURL?: string; ClientID: string; UsernameClaim?: string }
            | { Kind: "BuiltInIdP"; Namespace: string; ClientName: string };
        }>;
        userProfileProvider?: "TAILORDB" | string;
        userProfileProviderConfig?: {
          Kind: "TAILORDB";
          Namespace: string;
          Type: string;
          UsernameField: string;
          TenantIdField?: string;
          AttributesFields: string[];
          AttributeMap?: Record<string, string>;
        } | null;
        scimConfig?: {
          MachineUserName: string;
          Authorization: { Type: "oauth2" | "bearer"; BearerSecret?: { VaultName: string; SecretKey: string } };
          Resources: Array<{
            Name: string;
            TailorDBNamespace: string;
            TailorDBType: string;
            CoreSchema: {
              Name: string;
              Attributes: Array<{
                Type: "string" | "number" | "boolean" | "datetime" | "complex";
                Name: string;
                Description?: string;
                Mutability?: "readOnly" | "readWrite" | "writeOnly";
                Required?: boolean;
                MultiValued?: boolean;
                Uniqueness?: "none" | "server" | "global";
                CanonicalValues?: string[] | null;
                SubAttributes?: any[] | null;
              }>;
            };
            AttributeMapping: Array<{ TailorDBField: string; SCIMPath: string }>;
          }>;
        } | null;
        tenantProvider?: "" | string;
        tenantProviderConfig?: { Kind: "TAILORDB"; Namespace: string; Type: string; SignatureField: string } | null;
        machineUsers?: Array<{ Name: string; Attributes: string[]; AttributeMap?: Record<string, string | string[] | boolean | boolean[]> }>;
        oauth2Clients?: Array<{ Name: string; Description?: string; GrantTypes?: ("authorization_code" | "refresh_token")[]; RedirectURIs: string[]; ClientType?: "confidential" | "public" | "browser" }>;
      };
    };
  },

  executor?: { files: string[] };
  staticWebsites?: { [name: string]: { description?: string; allowedIpAddresses?: string[] } };

  generators?: Array<
    ["@tailor/kysely-type", { distPath: ({ app, tailorDB }: { app: string; tailorDB: string }) => string }]
    | ["@tailor/db-type", { distPath: ({ app, tailorDB }: { app: string; tailorDB: string }) => string }]
  >;

  tsConfig?: string; // custom tsconfig path for bundling
})
```

Notes:

- Output directory defaults to `.tailor-sdk`. Override with `TAILOR_SDK_OUTPUT_DIR`.
- When `id` is not set, `apply` validates the selected workspace (via tailorctl) matches `name` and `region`.

## TailorDB

TailorDB provides a type-safe way to define your data models using TypeScript.

### Defining Models

Create model files in your TailorDB directory (e.g., `src/tailordb/`):

```typescript
import { db, t } from "@tailor-platform/tailor-sdk";

// Define a simple model
export const product = db.type("Product", {
  name: db.string(), // required by default
  description: db.string().optional(),
  price: db.int(),
  weight: db.float().optional(),
  inStock: db
    .bool()
    .hooks({ create: ({ value }) => value ?? false })
    .optional({ assertNonNull: true }),
  category: db.enum("electronics", "clothing", "food"),
  tags: db.string().array(),
  ...db.fields.timestamps(),
});

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
| `db.date()`     | string          | Date          |
| `db.datetime()` | string          | DateTime      |
| `db.time()`     | string          | Time          |
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
  type: "n-1", // or "1-1" | "oneToOne" | "manyToOne" | "keyOnly"
  toward: { type: customer },
  backward: "orders", // optional reverse relation name
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
export const user = db.type("User", { name: db.string() });

// Custom plural form (User -> UserList)
export const person = db.type(["User", "UserList"], {
  name: db.string(),
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

You can also set via `features({ pluralForm: "UserList" })`.

### Timestamps and common fields

Add timestamp fields using the built-in helper:

```typescript
export const user = db.type("User", {
  email: db.string().unique(), // Required and unique
  name: db.string().optional(), // Optional field
  role: db.string().values(["admin", "user", "guest"]), // With allowed values
  ...db.fields.timestamps(), // Adds createdAt and updatedAt
});
```

### Nested objects

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

### Reusable field definitions

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
    type: "n-1",
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

### Type inference

Use TypeScript's type inference to get compile-time type safety:

```typescript
// Define the model with relations and validations
export const order = db.type("Order", {
  orderNumber: db.string().unique(),
  customerId: db.uuid().relation({
    type: "n-1",
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
        quantity: t.int(),
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

#### Function steps

Execute TypeScript functions:

```typescript
.fnStep("stepName", async (context) => {
  // Access previous steps via context
  // Access input via context.input
  return result;
})
```

#### SQL steps

Execute SQL queries. Provide `dbNamespace` (resolver defaults or per-step option):

```typescript
.sqlStep(
  "queryUsers",
  async (context) => {
    const rows = await context.client.exec<{ name: string }>(
      /* sql */ `SELECT name FROM "User" WHERE active = true`,
    );
    return rows;
  },
  { dbNamespace: "my-db" },
)
```

Note: Kysely types can be generated via the `@tailor/kysely-type` generator, but the runtime SQL API here is the provided `SqlClient` (`exec`, `execOne`).

### Processing Flow Patterns

#### Complex Multi-Step Resolver Example

Here's a comprehensive example combining different step types:

```typescript
import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";
import { format } from "date-fns";
// No custom DB wrapper required

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

  // Step 3: Another SQL step
  .sqlStep(
    "getRelatedData",
    async (ctx) => {
      const q = /* sql */ `SELECT id, totalAmount FROM "Order" WHERE userId = $1 ORDER BY createdAt DESC LIMIT 10`;
      return await ctx.client.exec<{ id: string; totalAmount: number }>(q, [
        ctx.getUserData.id,
      ]);
    },
    { dbNamespace: "my-db" },
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
          totalAmount: t.float(),
          productName: t.string(),
          formattedDate: t.string(),
        }),
      ),
      summary: t.object({
        totalOrders: t.int(),
        totalAmount: t.float(),
      }),
    }),
  );
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

export default createExecutor("user-welcome", "Send welcome email to new users")
  .on(
    recordCreatedTrigger(
      user,
      ({ newRecord }) => !!newRecord.email && newRecord.isActive,
    ),
  )
  .executeFunction({
    fn: async ({ newRecord, client }) => {
      // Send welcome email logic here
      console.log(`Sending welcome email to ${newRecord.email}`);
      await client.exec("/* sql */ SELECT 1");
    },
    dbNamespace: "my-db",
  });
```

Executors follow a simple pattern:

1. Create an executor with `createExecutor(name, description)`
2. Add a trigger with `.on(...)`
3. Choose a target: `.executeFunction({ ... })`, `.executeJobFunction({ ... })`, `.executeWebhook({ ... })`, or `.executeGql({ ... })`

### Trigger Types

#### Record triggers

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

#### Schedule triggers

- `scheduleTrigger(cron)` - Fires on a cron schedule

Use cron expressions. Optional timezone defaults to `UTC`.

```typescript
scheduleTrigger("*/5 * * * *"); // Every 5 minutes
scheduleTrigger("0 9 * * 1"); // Every Monday at 9 AM
scheduleTrigger("0 0 1 * *"); // First day of every month
// With timezone
// scheduleTrigger("0 * * * *", "Asia/Tokyo");
```

#### Incoming webhook triggers

- `incomingWebhookTrigger<T>()` - Fires when an external webhook is received

Use typed payloads for type safety:

```typescript
incomingWebhookTrigger<WebhookPayload>();
```

#### Resolver executed triggers

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

#### executeFunction / executeJobFunction

Execute JavaScript/TypeScript functions directly. Pass an options object:

```typescript
import sqlstring from "sqlstring";

...
.executeFunction({
  fn: async ({ newRecord, client }) => {
    const query = sqlstring.format(
      /* sql */ `SELECT * FROM "Order" WHERE customerId = ?`,
      [newRecord.id],
    );
    const result = await client.exec(query);
    console.log(`Found ${result.length} orders for customer`);
  },
  dbNamespace: "my-db", // optional
  // invoker: { authName: "auth-namespace", machineUser: "mu-name" },
})
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
  // You can use gql.tada or a plain string. Example with gql.tada:
  // import { graphql as gql } from "gql.tada";
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

#### Record trigger context

For `recordCreatedTrigger`, `recordUpdatedTrigger`, and `recordDeletedTrigger`:

- `newRecord` - The new record state (not available for delete triggers)
- `oldRecord` - The previous record state (only for update triggers)
- `client` — Database client with methods:
  - `exec<T>(sql: string, params?: readonly unknown[])` → `T[]`
  - `execOne<T>(sql: string, params?: readonly unknown[])` → `T`

#### Schedule trigger context

For `scheduleTrigger`:

- same `client` as above

#### Incoming webhook trigger context

For `incomingWebhookTrigger`:

- `payload` — Webhook request body (typed)
- `headers` — Webhook request headers
- `client` — Same `SqlClient` as above

#### Resolver executed trigger context

For `resolverExecutedTrigger`:

- `result` - The resolver's return value (when execution succeeds)
- `error` - The error object (when execution fails)
- `input` - The input that was passed to the resolver
- `client` — Same `SqlClient` as above

### Advanced Features

#### Conditional execution

Use filters to control when executors run:

```typescript
.on(
  recordUpdatedTrigger(product, ({ newRecord, oldRecord }) => {
    // Only trigger if price decreased by more than 10%
    return newRecord.price < oldRecord.price * 0.9;
  })
)
```

#### Vault integration

Securely access secrets for webhook authentication:

```typescript
.executeWebhook({
  headers: {
    "X-API-Key": { vault: "external-apis", key: "partner-api-key" },
  },
})
```

#### Error handling

Executors include built-in error handling and retry logic. Failed executions are logged and can be monitored through the Tailor console.

## Generators

The SDK includes built-in code generators:

- `@tailor/kysely-type`: generates Kysely table types from TailorDB
- `@tailor/db-type`: generates TypeScript types for TailorDB models

Configure generators in your `tailor.config.ts`:

```typescript
export default defineConfig({
  // ...
  generators: [
    [
      "@tailor/kysely-type",
      { distPath: ({ tailorDB }) => `./src/generated/${tailorDB}.ts` },
    ],
    [
      "@tailor/db-type",
      { distPath: ({ tailorDB }) => `./src/tailordb/${tailorDB}.types.ts` },
    ],
  ],
});
```

## CLI Commands

The SDK provides the following CLI commands:

```bash
# Initialize a new project
npx @tailor-platform/tailor-sdk init [project-name]

# Generate code (to .tailor-sdk/ and your generator outputs)
npx @tailor-platform/tailor-sdk generate

# Watch mode - regenerate on file changes
npx @tailor-platform/tailor-sdk generate --watch

# Apply (bundle resolvers/executors and apply to Tailor Platform)
npx @tailor-platform/tailor-sdk apply

# Dry run
npx @tailor-platform/tailor-sdk apply --dry-run

# Common options
#   --config, -c     Path to tailor.config.ts (default: tailor.config.ts)
#   --env-file, -e   Load environment from a file
```

### Environment Variables

Set these environment variables for deployment:

```bash
# Option 1: Provide an access token directly
export TAILOR_TOKEN=...  # Personal access token

# Option 2: Use tailorctl authentication (preferred for long-lived dev)
#   The SDK reads ~/.tailorctl/config and refreshes tokens automatically.

# Optional: override API base URL (default: https://api.tailor.tech)
export PLATFORM_URL=https://api.tailor.tech
```

Outputs:

- Bundled functions and executors are written under `.tailor-sdk/`.
- You can customize the output root with `TAILOR_SDK_OUTPUT_DIR`.
