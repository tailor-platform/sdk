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

## Code Generation and Derived-Data Safety

The SDK generates JavaScript (script expressions, rewritten sources) and derives
data (names, snapshots, caches) from user code. Failures in these paths must
surface at build time with a clear message, never as silently wrong output.

- Do not classify or transform function forms by matching regexes against
  `Function.prototype.toString()` output; parse the source with `oxc-parser`
  and decide from the AST.
- Validate generated code at the generation boundary: parse every generated
  script expression and every transformed source, and fail with the offending
  generated code and parse errors when it does not parse. A construct that must
  be rewritten during bundling must be detected when the rewrite could not be
  applied — do not rely on a runtime stub that throws after deploy.
- Enforce utility preconditions instead of assuming them (e.g. range-based
  source editing must reject overlapping ranges rather than corrupt output).
- When inserting a name derived from user configuration into a keyed record,
  reject duplicates with a descriptive error; never rely on last-write-wins.
  When adding a validation to one side of a symmetric pair (forward/backward
  relationships, diff/drift comparison), add or verify the mirrored side.
- When two code paths compare the same attribute set, derive both comparators
  from a single attribute list and declare intentional exclusions explicitly,
  so a newly added attribute cannot be silently skipped by one of them.
- If a stored artifact records an integrity hash, verify the hash when reading
  the artifact back; otherwise do not record it.

## CLI Command Design: Flags Over Positionals

politty has an opt-in plugin-dispatch hook (`onUnknownSubcommand`, not wired
up in this SDK yet) that execs an external `<cli>-<name>` binary for an
unrecognized subcommand. Its dispatch check skips any command that defines
`run`, regardless of whether that `run` parses a positional — so a command
that both parses one and has `subCommands` (a "hybrid") leaves no way to
tell an unrecognized first argument apart from a subcommand name.

- Prefer flags and subcommands over positional arguments. They're
  order-independent, unambiguous, and subcommand groups remain a plugin
  extension point.
- If a leaf command needs a positional, limit it to a single natural subject
  (e.g. `api inspect <endpoint>`) and give that command **no** `subCommands`
  of its own.
- Don't add a new hybrid command. `api`
  (`packages/sdk/src/cli/commands/api/index.ts`) is the one existing
  exception; this doesn't apply retroactively to commands whose `run` just
  forwards to a default subcommand with no arguments.
