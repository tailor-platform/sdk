---
"@tailor-platform/tailor-sdk": minor
---

Deletion and renaming of builtin generators

**Breaking Changes:**

Renamed `@tailor/kysely-type` to `@tailor-platform/kysely-type`. Also deleted `@tailor/db-type`.
If there are any use cases where you're already using `@tailor/db-type` and its deletion would be problematic, please let me know.
A type error occurs with `defineGenerators()`, so please change the configuration to resolve it.

before:

```typescript
defineGenerators(
  ["@tailor/kysely-type", { distPath: "./generated/kysely.ts" }],
  ["@tailor/db-type", { distPath: "./generated/db.ts" }],
);
```

after:

```typescript
defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: "./generated/kysely.ts" },
]);
```
