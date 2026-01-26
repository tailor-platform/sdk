---
paths:
  - "packages/sdk/src/configure/**/*.ts"
  - "packages/sdk/src/parser/**/*.ts"
  - "packages/sdk/src/cli/**/*.ts"
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
   - **Note**: Parse operations for TailorDB (inflection, relationship building) are performed automatically in `TailorDBService.loadTypes()` (located in `src/cli/application/tailordb/service.ts`)

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

## Preventing Bundling Issues with Zod and Type-Only Dependencies

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
   - After changes, run `pnpm exec turbo run test` in example to regenerate bundles
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
