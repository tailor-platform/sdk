# Bundler Kysely Import Rule

Bundler files under `src/cli/` generate entry scripts that are bundled by rolldown and executed server-side. These entry scripts must **never** import directly from `kysely` or `@tailor-platform/function-kysely-tailordb`.

**Always use the SDK re-export:**

```typescript
// ✅ Correct
import { Kysely, TailordbDialect } from "@tailor-platform/sdk/kysely";

// ❌ Wrong — causes "missing dependency" errors for users
import { Kysely } from "kysely";
import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
```

**Why:** Users install `@tailor-platform/sdk` but not `kysely` directly. The SDK re-exports kysely through `@tailor-platform/sdk/kysely` to avoid phantom dependency issues with pnpm strict hoisting.

**Scope:** This applies only to template strings in bundler files (generated code), not to `src/kysely/index.ts` which is the re-export definition itself.

**Guard test:** `src/cli/bundler/no-direct-kysely-import.test.ts` scans all bundler files to enforce this rule.
