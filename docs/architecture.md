# Architecture

## Overview

The SDK is a monorepo with these packages:

```
packages/
├── sdk/                      # Main SDK: configuration APIs + CLI
├── create-sdk/               # Project scaffolding (npm create @tailor-platform/sdk)
├── eslint-plugin-sdk/        # Lint rules for SDK applications
├── sdk-codemod/              # Codemod runner for SDK upgrades
├── sdk-plugin-frontend/      # SDK plugin: builds and uploads frontend assets on deploy
├── sdk-plugin-seed/          # CLI plugin: tailor seed
├── sdk-plugin-setup/         # CLI plugin: tailor setup
├── sdk-plugin-tailordb-erd/  # CLI plugin: tailor tailordb erd
├── shared/                   # Internal utilities (private; bundled into sdk, eslint-plugin-sdk, and sdk-codemod)
└── tailor-proto/             # Protocol buffer definitions (private; bundled into sdk)
example/                      # Development/testing example app
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

Besides these, `src/runtime/` holds SDK code that executes inside deployed functions on the platform — typed `tailor.*` API wrappers and field value validation (`runtime/field-parse.ts`). It is importable at runtime from every layer, so it is where configure and cli share runtime behavior without crossing their closed boundaries.

The essential constraint: **configure cannot depend on parser/cli at runtime**, because configure code is bundled into user output (resolvers, executors, workflows). Any runtime dependency pulled into configure inflates user bundle sizes.

The configure module's import boundaries enforced by oxlint:

1. **Cannot import from `cli/`** — CLI is deployment tooling, not user runtime
2. **Cannot import from `parser/`** (except `parser/**/types.ts`, type-only) — prevents Zod from leaking into user bundles
3. **Cannot import from `plugin/`** (except `plugin/types.ts`, type-only) — prevents plugin system code from bundling into user output
4. **Can only import allowlisted `utils/` modules** — pure helpers such as `brand` and `plugin-validation-error` are explicitly allowed by oxlint; other utils helpers may have dependencies that would inflate user bundle sizes

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

### CLI Plugin Dispatch

`main.ts` wires politty's `onUnknownSubcommand` to `dispatchPluginWithInstallHint` (`packages/sdk/src/cli/shared/plugin.ts`); [CLI Plugins](../packages/sdk/docs/cli-reference.md#cli-plugins-beta) describes what users see.

- politty calls `onUnknownSubcommand` for a top-level name (`tailor seed`) before `runMain`'s `setup` and for a nested one (`tailor tailordb erd`) after it, and in neither case runs the effects of `globalArgs` (such as `--verbose`) first, so host-side preparation for a plugin belongs in the dispatcher.
- The dispatcher reads `--env-file` and `--profile` from the forwarded args itself, before the plugin parses them. A first-party plugin that passes options to `createCommonArgs()` needs the same options in `KNOWN_PLUGIN_COMMON_ARGS_OPTIONS`, and one that changes how it parses `--profile` needs the same change in `explicitProfileFromArgs`.

### CLI Command Design: Flags Over Positionals

politty's plugin dispatch ([CLI Plugin Dispatch](#cli-plugin-dispatch)) skips any command that defines `run`, regardless of whether that `run` parses a positional — so a command that both parses one and has `subCommands` (a "hybrid") leaves no way to tell an unrecognized first argument apart from a subcommand name.

- Prefer flags and subcommands over positional arguments. They're order-independent, unambiguous, and subcommand groups remain a plugin extension point.
- If a leaf command needs a positional, limit it to a single natural subject (e.g. `api inspect <endpoint>`) and give that command **no** `subCommands` of its own.
- Don't add a new hybrid command. `api` (`packages/sdk/src/cli/commands/api/index.ts`) is the one existing exception; this doesn't apply retroactively to commands whose `run` just forwards to a default subcommand with no arguments.

## Package Exports

| Entry point                     | Source module       | Used by                                                          |
| ------------------------------- | ------------------- | ---------------------------------------------------------------- |
| `@tailor-platform/sdk`          | `configure/`        | SDK users in `tailor.config.ts`, resolvers, executors, workflows |
| `@tailor-platform/sdk/cli`      | `cli/lib.ts`        | Programmatic CLI access (e.g., `getDB()`)                        |
| `@tailor-platform/sdk/test`     | `utils/test/`       | Test utilities (`createTailorDBHook`, etc.)                      |
| `@tailor-platform/sdk/kysely`   | `kysely/`           | Kysely type re-exports                                           |
| `@tailor-platform/sdk/plugin`   | `plugin/`           | Custom plugin development                                        |
| `@tailor-platform/sdk/plugin/*` | `plugin/builtin/*/` | Built-in plugins (kysely-type, enum-constants, file-utils, seed) |
