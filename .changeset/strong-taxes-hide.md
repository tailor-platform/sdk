---
"@tailor-platform/tailor-sdk": patch
---

Added ignores option

When specifying files for db, resolver, and executor, we can now exclude specific files with `ignores`. Test-related files (`**/*.test.ts`, `**/*.spec.ts`) are excluded by default.

```typescript
defineConfig({
  db: {
    "my-db": {
      files: ["db/**/*.ts"],
      ignores: ["db/**/*.draft.ts"],
    },
  },
});
```
