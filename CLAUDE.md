# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

[!IMPORTANT] Read CLAUDE.local.md if exists.

## Commands

### Development

- `pnpm exec turbo run generate` - Run code generation for SDK components
- `pnpm exec turbo run generate:watch` - Run code generation in watch mode
- `pnpm exec turbo run apply` - Deploy to the Tailor Platform
- `pnpm exec turbo run dev` - Start development server
- `pnpm exec turbo run build` - Build all packages
- `pnpm exec turbo run test` - Run all tests using Turbo
- `pnpm exec turbo run check` - Run format, lint:fix, typecheck, and knip in sequence
- `pnpm exec turbo run knip` - Check for unused dependencies, exports, and files
- `pnpm exec turbo run lint` - Run ESLint
- `pnpm exec turbo run lint:fix` - Run ESLint with auto-fix
- `pnpm exec turbo run format` - Format code with Oxfmt
- `pnpm exec turbo run format:check` - Check code formatting
- `pnpm exec turbo run typecheck` - Run TypeScript type checking

### Package-specific Commands (in packages/sdk)

- `pnpm test` - Run all tests with Vitest
- `pnpm test path/to/test.ts` - Run specific test file
- `pnpm test -t "test name"` - Run tests matching pattern
- `pnpm build` - Build SDK with tsdown

### CLI Commands

See [packages/sdk/docs/cli-reference.md](packages/sdk/docs/cli-reference.md) for the full CLI reference.

Common commands:

- `pnpm exec tailor-sdk init <project-name>` - Initialize new project
- `pnpm exec tailor-sdk generate` - Generate code (types, SDL, bundled functions)
- `pnpm exec tailor-sdk apply` - Deploy to Tailor Platform
- `pnpm exec tailor-sdk show` - Show applied application information

## Architecture Overview

This is a **monorepo** managed by pnpm workspaces and Turbo. The main SDK package (`@tailor-platform/sdk`) is located at `packages/sdk`.

### Project Structure

```
/
├── packages/
│   ├── sdk/                 # Core SDK package
│   │   ├── src/
│   │   │   ├── configure/   # SDK user-facing APIs (minimal implementation)
│   │   │   │   ├── services/    # tailordb, resolver, executor, workflow, auth, idp, staticwebsite
│   │   │   │   ├── types/       # Type system and helpers
│   │   │   │   ├── config.ts
│   │   │   │   └── application.ts
│   │   │   ├── parser/      # Validation and parsing layer
│   │   │   │   ├── service/
│   │   │   │   │   └── auth/
│   │   │   │   └── generator-config.ts
│   │   │   └── cli/         # CLI implementation
│   │   │       ├── generator/   # Code generation system
│   │   │       ├── bundler/     # Rolldown bundler integration
│   │   │       ├── apply/       # Deployment API client and services
│   │   │       └── utils/
│   │   └── dist/            # Built output
│   ├── create-sdk/          # Project scaffolding CLI
│   └── tailor-proto/        # Generated protobuf definitions
├── example/                 # Example implementation
└── turbo.json               # Turbo build orchestration
```

### Key Components

1. **TailorDB** (`src/configure/services/tailordb/`)
   - Define type-safe database models using `db.type()`
   - Always export both the value and type: `export const model = db.type(...); export type model = typeof model;`
   - Use `db.fields.timestamps()` for automatic timestamp fields
   - Relations are defined with `.relation()` method
2. **Resolvers** (`src/configure/services/resolver/`)
   - Create GraphQL resolvers using `createResolver`
   - Define resolver configuration with `name`, `operation` (query/mutation), `input`, `body`, and `output`
   - The `body` function receives a context object with `input` and `user` properties
   - Use `getDB()` from generated files to access database with Kysely query builder
   - Return data directly from the body function (supports both sync and async)
3. **Executors** (`src/configure/services/executor/`)
   - Event-driven handlers using `createExecutor()`
   - Trigger on record changes: `recordCreatedTrigger`, `recordUpdatedTrigger`, `recordDeletedTrigger`
   - Execute functions, webhooks, or GraphQL operations
   - Use `getDB()` from generated files to access database with Kysely query builder
4. **Workflows** (`src/configure/services/workflow/`)
   - Orchestrate multiple jobs using `createWorkflow()` and `createWorkflowJob()`
   - **Important Rules:**
     - `createWorkflow()` result must be default exported
     - All jobs must be named exports (including mainJob and triggered jobs)
     - Job names must be unique across the entire project
     - Every workflow must specify a `mainJob`
   - Trigger other jobs using `.trigger()` method (e.g., `fetchCustomer.trigger({ id })`)
   - `.trigger()` is synchronous on server - do NOT use await with it
   - Use `getDB()` from generated files to access database with Kysely query builder
5. **Static Websites** (`src/configure/services/staticwebsite/`)
   - Define static website configurations using `defineStaticWebSite()`
   - Provides type-safe URL references via `.url` and `.callback` properties
   - Use `website.url` in CORS settings for type-safe configuration
   - Static website URLs are resolved at deployment time and injected into configuration
6. **Identity Provider (IdP)** (`src/configure/services/idp/`)
   - Define Identity Provider configurations using `defineIdp()`
   - Configure authorization rules and OAuth2 clients
   - Use `idp.provider()` method to create BuiltInIdP references for auth configuration
   - Supports multiple clients with automatic client selection
7. **Configuration** (`tailor.config.ts`)
   - Central configuration using `defineConfig()` for a single application
   - Required fields: `name`
   - Specify component locations with glob patterns
   - Configure generators using `defineGenerators()` - must include `@tailor-platform/kysely-type` for database access
   - Application-level settings: `cors`, `allowedIpAddresses`, `disableIntrospection`
8. **Code Generators**
   - `@tailor-platform/kysely-type`: Generates Kysely type definitions and `getDB()` function (required for database access)
   - Configure generators with `defineGenerators()` and specify `distPath` for output files

### Code Patterns

**Configuration Pattern:**

```typescript
import { defineConfig, defineAuth, defineIdp, defineStaticWebSite } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const website = defineStaticWebSite("my-frontend", {
  description: "my frontend application",
});

const idp = defineIdp("my-idp", {
  authorization: "loggedIn",
  clients: ["default-idp-client"],
});

const auth = defineAuth("my-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: {
      role: true,
    },
  },
  machineUsers: {
    "admin-machine-user": {
      attributes: {
        role: "ADMIN",
      },
    },
  },
  oauth2Clients: {
    sample: {
      redirectURIs: ["https://example.com/callback", `${website.url}/callback`],
      description: "Sample OAuth2 client",
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: idp.provider("sample", "default-idp-client"),
});

export default defineConfig({
  name: "my-app",
  cors: [website.url],
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  resolver: {
    "my-resolver": { files: ["./resolvers/**/resolver.ts"] },
  },
  idp: [idp],
  auth,
  executor: { files: ["./executors/*.ts"] },
  workflow: { files: ["./workflows/**/*.ts"] },
  staticWebsites: [website],
});
```

**Model Definition Pattern:**

```typescript
import { db } from "@tailor-platform/sdk";

export const modelName = db.type("ModelName", {
  field: db.string(),
  relatedId: db.uuid().relation({ type: "n-1", toward: { type: relatedModel } }),
  ...db.fields.timestamps(),
});
```

**Auth Configuration Pattern:**

```typescript
import { defineAuth, defineIdp } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

// Define IdP configuration
const idp = defineIdp("my-idp", {
  authorization: "loggedIn",
  clients: ["default-idp-client", "another-client"],
});

export const auth = defineAuth("my-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: {
      role: true,
    },
  },
  machineUsers: {
    "admin-machine-user": {
      attributes: {
        role: "ADMIN",
      },
    },
  },
  oauth2Clients: {
    sample: {
      redirectURIs: ["https://example.com/callback"],
      description: "Sample OAuth2 client",
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  // Use idp.provider() to reference the IdP with type safety
  idProvider: idp.provider("sample", "default-idp-client"),
});
```

**Static Website Configuration Pattern:**

```typescript
import { defineStaticWebSite, defineIdp, defineAuth, defineConfig } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

// Define a static website with type-safe URL references
const website = defineStaticWebSite("my-frontend", {
  description: "my frontend application",
});

const idp = defineIdp("my-idp", {
  authorization: "loggedIn",
  clients: ["default-idp-client"],
});

// Use website.url for type-safe configuration
export default defineConfig({
  name: "my-app",
  cors: [website.url], // Resolved to actual URL at deployment
  auth: defineAuth("my-auth", {
    userProfile: {
      type: user,
      usernameField: "email",
      attributes: { role: true },
    },
    oauth2Clients: {
      sample: {
        redirectURIs: [
          "https://example.com/callback",
          `${website.url}/callback`, // Resolved to actual URL/callback at deployment
        ],
        description: "Sample OAuth2 client",
        grantTypes: ["authorization_code", "refresh_token"],
      },
    },
    idProvider: idp.provider("sample", "default-idp-client"),
  }),
  idp: [idp],
  staticWebsites: [website], // Array format
});
```

**Generator Configuration Pattern:**

```typescript
import { defineGenerators } from "@tailor-platform/sdk";

export const generators = defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: "./generated/tailordb.ts" },
]);
```

**Important**: The `@tailor-platform/kysely-type` generator is required to use Kysely query builder in resolvers and executors.

**Prerequisites**:

1. Install required dependencies:
   ```bash
   pnpm add -D @tailor-platform/function-kysely-tailordb @tailor-platform/function-types
   ```

This generator creates:

- Type-safe Kysely table definitions for all TailorDB types
- `getDB(namespace)` function to create Kysely instances
- Type definitions for database operations

**Resolver Pattern:**

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "generated/tailordb";

export default createResolver({
  name: "resolverName",
  operation: "query", // or "mutation"
  input: {
    field: t.string(),
  },
  body: async (context) => {
    // Access: context.input, context.user
    // Use getDB() to access database with Kysely
    const db = getDB("tailordb");
    const result = await db
      .selectFrom("TableName")
      .selectAll()
      .where("field", "=", context.input.field)
      .execute();

    return { result };
  },
  output: t.object({
    result: t.string(),
  }),
});
```

**Executor Pattern:**

```typescript
import { createExecutor, recordCreatedTrigger, t } from "@tailor-platform/sdk";
import { getDB } from "generated/tailordb";
import { user } from "tailordb/user";

const handler = async ({ newRecord }: { newRecord: t.infer<typeof user> }) => {
  // Use getDB() to access database with Kysely
  const db = getDB("tailordb");
  const record = await db
    .selectFrom("User")
    .selectAll()
    .where("id", "=", newRecord.id)
    .executeTakeFirst();

  console.log(`New user: ${record?.name}`);
};

export default createExecutor({
  name: "userLogger",
  description: "Logs user creation",
  trigger: recordCreatedTrigger({
    type: user,
  }),
  operation: {
    kind: "function",
    body: handler,
  },
});
```

**Workflow Pattern:**

```typescript
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { getDB } from "generated/tailordb";

// All jobs must be named exports
export const fetchData = createWorkflowJob({
  name: "fetch-data",
  body: async (input: { id: string }) => {
    const db = getDB("tailordb");
    return await db.selectFrom("Table").selectAll().where("id", "=", input.id).executeTakeFirst();
  },
});

// Jobs that trigger other jobs - also must be named exports
export const processData = createWorkflowJob({
  name: "process-data",
  body: (input: { id: string }) => {
    // Use .trigger() to call other jobs (synchronous on server, do NOT await)
    const data = fetchData.trigger({ id: input.id });
    return { processed: true, data };
  },
});

// Workflow must be default export
export default createWorkflow({
  name: "data-processing",
  mainJob: processData,
});
```

### Important Notes

- This project uses ESM modules and requires Node.js 22.14.0+
- Package manager: pnpm 10.17.1 (configured in packageManager field)
- TypeScript is configured in strict mode
- Lefthook runs pre-commit checks automatically (lint, format, typecheck)
- The SDK uses Rolldown for bundling and Turbo for task orchestration
- Test framework: Vitest
- Build tool: tsdown for creating ESM bundles
- **DO NOT use dynamic imports** (`await import()` or `require()`). Always use static imports at the top of files

### Testing

- Run tests: `pnpm exec turbo run test` or `pnpm test` in specific packages
- Tests use Vitest
- Test files: `**/__tests__/**/*.ts` or `**/?(*.)+(spec|test).ts`
- Example tests are in `example/tests/` and `example/e2e/`
