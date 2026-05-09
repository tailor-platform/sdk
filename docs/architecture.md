# Architecture

## Overview

The SDK is a monorepo with three packages:

```
packages/
├── sdk/           # Main SDK: configuration APIs + CLI
├── create-sdk/    # Project scaffolding (create-tailor-sdk)
└── tailor-proto/  # Protocol buffer definitions
example/           # Development/testing example app
```

The main `packages/sdk` has four core modules:

```
src/
├── configure/   User-facing API (defineConfig, db.type, createResolver, ...)
├── parser/      Validation & transformation layer (Zod schemas → internal types)
├── cli/         CLI commands, bundling, deployment
└── plugin/      Plugin system (manager + built-in plugins)
```

These modules have strict import boundaries enforced by ESLint. See [`packages/sdk/eslint.config.js`](../packages/sdk/eslint.config.js) for the full rules.

The essential constraint: **configure cannot depend on parser/cli at runtime**, because configure code is bundled into user output (resolvers, executors, workflows). Any runtime dependency pulled into configure inflates user bundle sizes.

The configure module's import boundaries enforced by ESLint:

1. **Cannot import from `cli/`** — CLI is deployment tooling, not user runtime
2. **Cannot import from `parser/`** (use `@/types/` instead) — prevents Zod from leaking into user bundles
3. **Cannot import from `plugin/`** — prevents plugin system code from bundling into user output
4. **Can only import `utils/brand` or `utils/test/*`** — other utils helpers may have dependencies that would inflate user bundle sizes

## Design Decisions

### Schema/Types Separation (Zod Bundling Prevention)

**Problem:** `export type * from "./module"` looks like a type-only re-export, but bundlers still resolve the entire module graph including runtime dependencies. If a configure module re-exports types from a parser module that imports Zod, Zod gets bundled into user output.

**Example of the problem chain:**

```
configure/auth/index.ts
  → export type * from "../../parser/auth"
    → parser/auth/index.ts
      → import { schema } from "./schema"
        → import { z } from "zod"  ← bundled into user output!
```

**Solution:** Separate schema files (runtime Zod imports) from types files (type-only imports):

```
parser/service/auth/
├── schema.ts     # Zod schemas — runtime imports, never re-exported from configure
├── types.ts      # Type definitions using `import type` only
└── index.ts      # Re-exports: `export { Schema } from "./schema"` + `export type * from "./types"`
```

Configure modules can safely import types from `parser/**/types.ts` because those files only use `import type`, which bundlers erase completely.

**Verification:** After changes, check that user bundles don't contain `$ZodType` or similar Zod internals. Bundle size regressions (e.g., 18KB → 68KB) indicate a violated boundary.

### Plugin Entry Point Separation

Built-in plugins are exported as separate entry points (`@tailor-platform/sdk/plugin/kysely-type`, etc.) rather than from the main `@tailor-platform/sdk` entry point. This prevents the CLI layer from being pulled into `tailor.config.ts` when users import a plugin.

### Parser as Intermediary

The CLI module cannot import from configure directly. Instead, it uses parser as an intermediary. This ensures:

1. Configure stays minimal (user-facing API only)
2. Validation logic lives in one place (parser)
3. CLI depends on validated/transformed types, not raw user input

## Package Exports

| Entry point                     | Source module       | Used by                                                          |
| ------------------------------- | ------------------- | ---------------------------------------------------------------- |
| `@tailor-platform/sdk`          | `configure/`        | SDK users in `tailor.config.ts`, resolvers, executors, workflows |
| `@tailor-platform/sdk/cli`      | `cli/lib.ts`        | Programmatic CLI access (e.g., `getDB()`)                        |
| `@tailor-platform/sdk/test`     | `utils/test/`       | Test utilities (`createTailorDBHook`, etc.)                      |
| `@tailor-platform/sdk/kysely`   | `kysely/`           | Kysely type re-exports                                           |
| `@tailor-platform/sdk/plugin`   | `plugin/`           | Custom plugin development                                        |
| `@tailor-platform/sdk/plugin/*` | `plugin/builtin/*/` | Built-in plugins (kysely-type, enum-constants, file-utils, seed) |
