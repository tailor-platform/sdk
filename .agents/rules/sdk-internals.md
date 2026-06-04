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

**Import Restrictions:**

1. **Configure Module** (`src/configure/**/*.ts`):
   - ❌ Cannot import from `cli` module
   - ❌ Cannot import from `parser` module
   - ✅ Can import from `@/types/` (shared type layer)
   - ⚠️ Can only import types from `zod` (runtime imports are forbidden)

2. **Parser Module** (`src/parser/**/*.ts`):
   - ❌ Cannot import from `cli` module
   - ❌ Cannot import from `configure` module
   - ✅ Can import from `@/types/` (shared type layer)

3. **CLI Module** (`src/cli/**/*.ts`):
   - Uses parser module to process user configurations

4. **Parser Types Files** (`src/parser/**/types.ts`):
   - ✅ Can only import types (all imports must be type-only)
   - Should only re-export from `@/types/` (backward compatibility shims)

5. **Types Module** (`src/types/**/*.ts`):
   - ❌ Cannot import from `configure`, `cli`, `parser`, `plugin` modules
   - ✅ Can import from `@/types/` (self-referencing) and external packages

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

**Solution: The `src/types/` Layer**

Zod schemas live in `parser/**/schema.ts`. Types derived from those schemas are generated into `src/types/*.generated.ts` by zinfer, cleanly separating runtime schema code from type definitions. See the `schema-types` rule for details.

Key principles:

- Schema files (`parser/**/schema.ts`) export only Zod schemas, never types
- Types are generated into `src/types/*.generated.ts` — no runtime dependency on zod
- Configure and parser modules import types from `@/types/`, not from each other
- This prevents bundlers from including zod runtime code in configure module outputs
