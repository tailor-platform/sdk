# [Tailor SDK](https://github.com/tailor-platform/tailor-sdk/pkgs/npm/tailor-sdk)

A development kit for building applications on the Tailor Platform.

## Table of Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [TailorDB](#tailordb)
  - [Defining Models](#defining-models)
  - [Field Types](#field-types)
  - [Timestamps and Common Fields](#timestamps-and-common-fields)
  - [Type Inference](#type-inference)
- [Pipeline Resolvers](#pipeline-resolvers)
  - [Creating Resolvers](#creating-resolvers)
  - [Step Types](#step-types)
  - [Processing Flow Patterns](#processing-flow-patterns)
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
- Update `.npmrc` with GitHub Packages registry settings
- Update `.gitignore` to exclude generated files

Existing files are never overwritten - the command safely skips any files that already exist.

### Manual Installation

If you prefer to add Tailor SDK to an existing project:

`.npmrc`

```.npmrc
@tailor-inc:registry=https://npm.pkg.github.com
@tailor-platform:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

For `GITHUB_PACKAGES_TOKEN`, please [generate a Personal Access Token](https://github.com/settings/tokens/new) with `read:packages` scope and configure SSO to `tailor-inc` / `tailor-platform`.

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
