---
paths:
  - "packages/sdk/src/configure/**/*.ts"
  - "packages/sdk/src/parser/**/*.ts"
  - "packages/sdk/src/cli/**/*.ts"
  - "packages/sdk/src/plugin/**/*.ts"
  - "packages/sdk/src/types/**/*.ts"
---

# SDK Internals

## Module Architecture and Import Rules

The SDK enforces strict module boundaries to maintain a clean architecture:

**Module Responsibilities:**

1. **Configure Module** (`src/configure/**/*.ts`):
   - Library interface directly used by SDK users
   - Must be kept minimal in implementation size
   - Provides type-safe configuration APIs

2. **Parser Module** (`src/parser/**/*.ts`):
   - Validates and parses definitions created in configure module
   - Acts as intermediary between configure and cli modules
   - **Note**: Parse operations for TailorDB (inflection, relationship building) are performed automatically in `TailorDBService.loadTypes()` (located in `src/cli/services/tailordb/service.ts`)

3. **CLI Module** (`src/cli/**/*.ts`):
   - Implements CLI commands
   - Performs transform, bundle, apply operations
   - Uses parser module to process user configurations

**Import Restrictions (enforced by oxlint `no-restricted-imports`):**

1. **Configure Module** (`src/configure/**/*.ts`):
   - ❌ Cannot import from `cli` module
   - ❌ Cannot import from `parser` / `plugin` modules — **except their pure type modules, type-only**
   - ⚠️ Can only import types from `zod` (runtime imports are forbidden)

2. **Parser Module** (`src/parser/**/*.ts`):
   - ❌ Cannot import from `cli` module
   - ❌ Cannot import from `configure` module — **except configure pure type modules, type-only**

3. **CLI Module** (`src/cli/**/*.ts`):
   - ❌ Cannot import from `configure` module — **except configure pure type modules, type-only**
   - Uses parser module to process user configurations

4. **Plugin Module** (`src/plugin/**/*.ts`):
   - ❌ Cannot import from `cli` module
   - ❌ Cannot import from `configure` module — **except configure pure type modules, type-only**

5. **Types Module** (`src/types/**/*.ts`):
   - Contains only zinfer-generated types and `helpers.ts` (generic utilities)
   - ❌ Cannot import from `configure`, `cli`, `parser`, `plugin` modules

## Pure Type Modules

Shared hand-written types live in **pure type modules** owned by each layer:
`parser/**/types.ts`, `configure/**/types.ts`, `configure/**/*.types.ts`,
`plugin/types.ts`, `runtime/types.ts`. These files define types (they are not
re-export shims) and are the only files other layers may reach across closed
boundaries — always type-only.

Pure type module rules (enforced by oxlint):

- All imports must be type-only (`import type`)
- ❌ No `zod` imports, even type-only
- ❌ No `**/schema` imports, even type-only — schema-derived types must come
  from zinfer output (`src/types/*.generated.ts`)

This guarantees, by construction, that importing the SDK's user-facing entry
points never loads zod — neither its runtime code nor its type machinery. The
`check:zod-isolation` script (part of `pnpm check`) verifies this on the built
artifacts: every `package.json#exports` entry except `./cli` must be zod-free
in both its `.d.mts` and `.mjs` import closures.

## No Import Cycles (Type-Level Included)

The `src/` module graph must stay acyclic, counting type-only imports as
edges. Two complementary checks enforce this:

- oxlint `import/no-cycle` with `ignoreTypes: false` rejects cycles formed by
  import declarations in linted files.
- `check:import-cycles` (part of `pnpm check`) builds the full graph —
  including lint-ignored generated files and inline `import("...")` type
  references emitted by zinfer — and fails on any strongly connected
  component.

When two pure type modules would need each other, move the shared type into
the module that semantically owns it and re-export from the other (see
`PluginAttachment`, defined in `configure/services/tailordb/types.ts` and
re-exported by `plugin/types.ts`).

**Type Import Rules:**

- Always use type-only imports for consistency: `import type { Foo } from "..."` or `import { type Foo } from "..."`
- Prefer inline type imports: `import { type Foo } from "..."`
- **Special case for `export type`**: Even when `allowTypeImports: true` is configured, `export type` statements will still trigger ESLint errors. In such cases, you may use `eslint-disable` comments for the export line

## Preventing Bundling Issues with Zod and Type-Only Dependencies

**Problem:** Even with `export type *` syntax, bundlers resolve the entire module graph including runtime dependencies. This can cause unnecessary libraries like zod to be bundled into output files.

**Root Cause:**

- `export type * from "./module"` is TypeScript syntax for the type system, not a bundler instruction
- Bundlers follow the module chain and include all runtime imports, even when only types are needed
- Example: `configure/auth` → `parser/auth` → `parser/auth/schema` → `zod` (runtime import)

**Solution:**

- Zod schemas live in `parser/**/schema.ts` and export only schemas, never types
- Types derived from schemas are generated into `src/types/*.generated.ts` by zinfer — no runtime dependency on zod
- Hand-written shared types live in pure type modules, whose import closure contains no runtime modules at all, so even a bundler that resolves the full module graph finds nothing to include
- See the `schema-types` rule for details

## CLI Command Design: Flags Over Positionals

politty supports an opt-in plugin-dispatch hook (`onUnknownSubcommand`, not
currently wired up in this SDK's `runMain()` call) that execs an external
`<cli>-<name>` binary for an unrecognized subcommand. Its dispatch check
skips any command that defines its own `run`, since an unrecognized
positional there is a real argument, not an unknown subcommand name. The
check only looks at whether `run` is defined, not at what `run` does with
its arguments — so a command that mixes `subCommands` with a `run` consuming
a positional (a "hybrid" command) leaves no way to tell whether an
unrecognized first argument was meant as the positional or as a subcommand
name. Designing away from hybrids now keeps this dispatch path usable if it
is wired up later.

- Prefer flags and subcommands over positional arguments. They're
  order-independent, unambiguous, and subcommand groups remain a plugin
  extension point.
- If a leaf command needs a positional, limit it to a single natural subject
  (e.g. `api inspect <endpoint>`) and give that command **no** `subCommands`
  of its own.
- Do not mix `subCommands` with a `run` that consumes a positional on the
  same command. A `run` that takes no arguments and only forwards to a
  default subcommand (e.g. `runCommand(defaultSubCommand, [])`) is fine — the
  hybrid to avoid is one where `run` actually parses positional input.
