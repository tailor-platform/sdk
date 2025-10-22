# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

- `pnpm exec turbo run gen` - Run code generation for Tailor SDK components
- `pnpm exec turbo run gen:watch` - Run code generation in watch mode
- `pnpm exec turbo run apply` - Deploy to the Tailor Platform
- `pnpm exec turbo run dev` - Start development server
- `pnpm exec turbo run build` - Build all packages
- `pnpm exec turbo run test` - Run all tests using Turbo
- `pnpm exec turbo run check` - Run format, lint:fix, and typecheck in sequence
- `pnpm exec turbo run lint` - Run ESLint
- `pnpm exec turbo run lint:fix` - Run ESLint with auto-fix
- `pnpm exec turbo run format` - Format code with Prettier
- `pnpm exec turbo run format:check` - Check code formatting
- `pnpm exec turbo run typecheck` - Run TypeScript type checking

### Package-specific Commands (in packages/tailor-sdk)

- `pnpm test` - Run all tests with Vitest
- `pnpm test path/to/test.ts` - Run specific test file
- `pnpm test -t "test name"` - Run tests matching pattern
- `pnpm build` - Build SDK with tsdown

### CLI Commands

- `pnpm exec tailor-sdk init <project-name>` - Initialize new project
- `pnpm exec tailor-sdk generate` - Generate code (types, SDL, bundled functions)
- `pnpm exec tailor-sdk generate --watch` - Watch mode for regeneration
- `pnpm exec tailor-sdk apply` - Deploy to Tailor Platform

## Architecture Overview

This is a **monorepo** managed by pnpm workspaces and Turbo. The main SDK package (`@tailor-platform/tailor-sdk`) is located at `packages/tailor-sdk`, with examples in `examples/basic`.

### Project Structure

```
/
├── packages/
│   ├── tailor-sdk/          # Core SDK package
│   │   ├── src/
│   │   │   ├── configure/   # SDK user-facing APIs (minimal implementation)
│   │   │   │   ├── services/    # tailordb, pipeline, executor, auth, idp, staticwebsite
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
│   └── tailor-proto/        # Generated protobuf definitions
├── examples/
│   └── basic/               # Example implementation
└── turbo.json               # Turbo build orchestration
```

### Key Components

1. **TailorDB** (`src/configure/services/tailordb/`)
   - Define type-safe database models using `db.type()`
   - Always export both the value and type: `export const model = db.type(...); export type model = typeof model;`
   - Use `db.fields.timestamps()` for automatic timestamp fields
   - Relations are defined with `.relation()` method

2. **Pipeline Resolvers** (`src/configure/services/pipeline/`)
   - Create GraphQL resolvers using `createResolver`
   - Define resolver configuration with `name`, `operation` (query/mutation), `input`, `body`, and `output`
   - The `body` function receives a context object with `input`, `user`, and `client` properties
   - Return data directly from the body function (supports both sync and async)

3. **Executors** (`src/configure/services/executor/`)
   - Event-driven handlers using `createExecutor()`
   - Trigger on record changes: `recordCreatedTrigger`, `recordUpdatedTrigger`, `recordDeletedTrigger`
   - Execute functions, webhooks, or GraphQL operations

4. **Static Websites** (`src/configure/services/staticwebsite/`)
   - Define static website configurations using `defineStaticWebSite()`
   - Provides type-safe URL references via `.url` and `.callback` properties
   - Use `website.url` in CORS settings for type-safe configuration
   - Static website URLs are resolved at deployment time and injected into configuration

5. **Identity Provider (IdP)** (`src/configure/services/idp/`)
   - Define Identity Provider configurations using `defineIdp()`
   - Configure authorization rules and OAuth2 clients
   - Use `idp.provider()` method to create BuiltInIdP references for auth configuration
   - Supports multiple clients with automatic client selection

6. **Configuration** (`tailor.config.ts`)
   - Central configuration using `defineConfig()` for a single application
   - Required fields: `workspaceId` and `name`
   - Specify component locations with glob patterns
   - Configure generators for code generation
   - Application-level settings: `cors`, `allowedIPAddresses`, `disableIntrospection`

### Code Patterns

**Configuration Pattern:**

```typescript
import {
  defineConfig,
  defineAuth,
  defineIdp,
  defineStaticWebSite,
} from "@tailor-platform/tailor-sdk";
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
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  cors: [website.url],
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  pipeline: {
    "my-pipeline": { files: ["./resolvers/**/resolver.ts"] },
  },
  idp: [idp],
  auth,
  executor: { files: ["./executors/*.ts"] },
  staticWebsites: [website],
});
```

**Model Definition Pattern:**

```typescript
import { db } from "@tailor-platform/tailor-sdk";

export const modelName = db.type("ModelName", {
  field: db.string(),
  relatedId: db
    .uuid()
    .relation({ type: "n-1", toward: { type: relatedModel } }),
  ...db.fields.timestamps(),
});
```

**Auth Configuration Pattern:**

```typescript
import { defineAuth, defineIdp } from "@tailor-platform/tailor-sdk";
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
import {
  defineStaticWebSite,
  defineIdp,
  defineAuth,
  defineConfig,
} from "@tailor-platform/tailor-sdk";
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
  workspaceId: process.env.WORKSPACE_ID!,
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

**Resolver Pattern:**

```typescript
export default createResolver({
  name: "resolverName",
  operation: "query", // or "mutation"
  input: t.type({
    field: t.string(),
  }),
  body: (context) => {
    // Access: context.input, context.user, context.client
    return { result: "value" };
  },
  output: t.type({
    result: t.string(),
  }),
});
```

**Executor Pattern:**

```typescript
export default createExecutor("name", "description")
  .on(recordCreatedTrigger(model))
  .executeFunction({ fn: handler, dbNamespace: "tailordb" });
```

### Important Notes

- This project uses ESM modules and requires Node.js 22.14.0+
- Package manager: pnpm 10.17.1 (configured in packageManager field)
- TypeScript is configured in strict mode
- Lefthook runs pre-commit checks automatically (lint, format, typecheck)
- The SDK uses Rolldown for bundling and Turbo for task orchestration
- Test framework: Vitest
- Build tool: tsdown for creating ESM bundles

### Module Architecture and Import Rules

The SDK enforces strict module boundaries to maintain a clean architecture:

**Module Responsibilities:**

1. **Configure Module** (`src/configure/**/*.ts`):
   - Library interface directly used by SDK users
   - Must be kept minimal in implementation size
   - Provides type-safe configuration APIs

2. **Parser Module** (`src/parser/**/*.ts`):
   - Validates and parses definitions created in configure module
   - Acts as intermediary between configure and cli modules

3. **CLI Module** (`src/cli/**/*.ts`):
   - Implements CLI commands
   - Performs transform, bundle, apply operations
   - Uses parser module to process user configurations

**Import Restrictions:**

1. **Configure Module** (`src/configure/**/*.ts`):
   - ❌ Cannot import from `cli` module
   - ❌ Cannot import from `parser` module
   - ✅ Can import types from `@/parser/**/types` files only
   - ⚠️ Can only import types from `zod` (runtime imports are forbidden)

2. **Parser Module** (`src/parser/**/*.ts`):
   - ❌ Cannot import from `cli` module
   - ⚠️ Cannot import from `configure` module (currently commented out in eslint.config.js)

3. **CLI Module** (`src/cli/**/*.ts`):
   - ⚠️ Cannot import from `configure` module (currently commented out in eslint.config.js - use parser module as intermediary)

4. **Parser Types Files** (`src/parser/**/types.ts`):
   - ✅ Can only import types (all imports must be type-only)

**Note on ESLint Rules:**
Some import restriction rules in `eslint.config.js` are currently commented out due to existing violations in the codebase. These rules represent the target architecture and should be followed when writing new code or refactoring existing code. When editing files, actively work to reduce violations and move towards enabling these rules.

**Type Import Rules:**

- Always use type-only imports for consistency: `import type { Foo } from "..."` or `import { type Foo } from "..."`
- Prefer inline type imports: `import { type Foo } from "..."`
- **Special case for `export type`**: Even when `allowTypeImports: true` is configured, `export type` statements will still trigger ESLint errors. In such cases, you may use `eslint-disable` comments for the export line

### Preventing Bundling Issues with Zod and Type-Only Dependencies

**Problem:** Even with `export type *` syntax, bundlers resolve the entire module graph including runtime dependencies. This can cause unnecessary libraries like zod to be bundled into output files.

**Root Cause:**

- `export type * from "./module"` is TypeScript syntax for the type system, not a bundler instruction
- Bundlers follow the module chain and include all runtime imports, even when only types are needed
- Example: `configure/auth` → `parser/auth` → `parser/auth/schema` → `zod` (runtime import)

**Solution Pattern: Separate Type Definitions from Runtime Code**

When working with validation libraries like zod:

1. **Create separate files for schemas and types:**

```typescript
// schema.ts - Runtime validation schemas
import z from "zod";

export const MySchema = z.object({
  name: z.string(),
  age: z.number(),
});

// NO type exports here!
// BAD: export type MyType = z.output<typeof MySchema>;
```

```typescript
// types.ts - Type definitions only
import type { z } from "zod"; // Type-only import
import type { MySchema } from "./schema";

export type MyType = z.output<typeof MySchema>;

// All other types that depend on schema types
export type MyOtherType = {
  /* ... */
};
```

```typescript
// index.ts - Re-export types
export { MySchema } from "./schema";
export type * from "./types";
```

2. **Key principles:**
   - Use `import type { z } from "zod"` in type-only files (compile-time only, won't be bundled)
   - Keep `z.output<typeof Schema>` type extractions in separate `.types.ts` files
   - Schema files should only export zod schemas, not types
   - This prevents bundlers from including zod runtime code in configure module outputs

3. **Verification:**
   - After changes, run `pnpm exec turbo run test` in examples to regenerate bundles
   - Check bundle sizes and search for library-specific code (e.g., `$ZodType`) to confirm removal
   - Expected result: Significant bundle size reduction (e.g., 68KB → 18KB in test cases)

**Example Directory Structure:**

```
parser/service/auth/
├── schema.ts     # Zod schemas (runtime imports)
├── types.ts      # Type definitions using import type
└── index.ts      # Re-exports
```

This pattern aligns with the module architecture principle that configure modules should not depend on parser modules at runtime, only at the type level.

### Testing

- Run tests: `pnpm exec turbo run test` or `pnpm test` in specific packages
- Tests use Vitest
- Test files: `**/__tests__/**/*.ts` or `**/?(*.)+(spec|test).ts`
- Example tests are in `examples/basic/tests/` and `examples/basic/e2e/`
