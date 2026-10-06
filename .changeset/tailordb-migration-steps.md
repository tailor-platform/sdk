---
"@tailor-platform/sdk": minor
---

A TailorDB migration script can now export `steps` instead of `main` to split its data migration into steps. Each step runs as its own job in its own transaction, so a long migration is no longer bound by a single job's execution-time limit, and `dependsOn` declares which steps must complete before another starts.

```ts
import type { MigrationSteps } from "./db";

export const steps = {
  backfillInvoice: {
    run: async (trx) => {
      /* ... */
    },
  },
  recomputeTotals: {
    dependsOn: ["backfillInvoice"],
    run: async (trx, { env }) => {
      /* ... */
    },
  },
} satisfies MigrationSteps;
```

When a step fails after other steps completed, `tailor deploy` keeps the migration in progress instead of rolling it back: the next deploy resumes it from the steps that have not completed, and `tailordb migration status` reports it. A script with a single step runs like a `main` script, in one transaction, and is rolled back on any failure. Steps must be safe to run again. `runMigrationSteps` in `@tailor-platform/sdk/vitest` runs `steps` in tests the same way. Scripts that export `main` behave as before; a script that exports both runs `main` and warns that `steps` is ignored.
