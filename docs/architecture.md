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
├── configure/   User-facing API (defineConfig, db.table, createResolver, ...)
├── parser/      Validation & transformation layer (Zod schemas → internal types)
├── cli/         CLI commands, bundling, deployment
└── plugin/      Plugin system (manager + built-in plugins)
```

These modules have strict import boundaries enforced by oxlint. See [`packages/sdk/.oxlintrc.json`](../packages/sdk/.oxlintrc.json) for the full rules.

The essential constraint: **configure cannot depend on parser/cli at runtime**, because configure code is bundled into user output (resolvers, executors, workflows). Any runtime dependency pulled into configure inflates user bundle sizes.

The configure module's import boundaries enforced by oxlint:

1. **Cannot import from `cli/`** — CLI is deployment tooling, not user runtime
2. **Cannot import from `parser/`** (except `parser/**/types.ts`, type-only) — prevents Zod from leaking into user bundles
3. **Cannot import from `plugin/`** (except `plugin/types.ts`, type-only) — prevents plugin system code from bundling into user output
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

**Solution:** Three kinds of type homes, none of which can reach Zod:

1. **Generated types** — Zod schemas live in `parser/**/schema.ts`; their types are generated into `src/types/*.generated.ts` by zinfer (`pnpm generate`). `src/types/` contains only these and `helpers.ts` (generic utilities).
2. **Pure type modules** — hand-written shared types live next to the code that owns them, in files named `types.ts` (or `*.types.ts` under `configure/`): e.g. `parser/service/tailordb/types.ts` (parsed structures), `configure/services/auth/types.ts` (config input types), `plugin/types.ts` (plugin authoring types), `runtime/types.ts` (runtime principal types). oxlint enforces that these files contain type-only imports and reference neither `zod` nor `**/schema` — even type-only, so the user's tsc never loads Zod's type machinery either.
3. **Cross-layer access** — otherwise-closed boundaries (configure → parser, cli → configure, plugin → configure) are open _only_ for pure type modules, _only_ type-only.

Because a pure type module's import closure contains no runtime modules at all, even a bundler that resolves the full module graph finds nothing to include.

**Verification:** `check:zod-isolation` (part of `pnpm check`) walks the import closure of every `package.json#exports` entry in `dist/` and fails if any entry other than `./cli` can reach a zod import — in its rolled-up `.d.mts` graph (type level) or its `.mjs` graph (runtime level).

### Plugin Entry Point Separation

Built-in plugins are exported as separate entry points (`@tailor-platform/sdk/plugin/kysely-type`, etc.) rather than from the main `@tailor-platform/sdk` entry point. This prevents the CLI layer from being pulled into `tailor.config.ts` when users import a plugin.

### Parser as Intermediary

The CLI module cannot import from configure directly (except configure pure type modules, type-only). Instead, it uses parser as an intermediary. This ensures:

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
