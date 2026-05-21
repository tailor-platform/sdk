---
"@tailor-platform/sdk": patch
---

Colocate `src/vitest/` tests next to their sources (drop the
`src/vitest/__tests__/` directory). Vitest discovers the test files
via the existing `**/?(*.)+(spec|test).ts` include pattern, so the
`**/__tests__/**/*.ts` entry has been removed from `vitest.config.ts`.
The nested integration runner moves from
`src/vitest/__tests__/integration/` to `src/vitest/integration/`. Pure
refactor: no public API or behavior changes.
