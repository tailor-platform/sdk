---
"@tailor-platform/sdk": minor
---

Add `validate` subcommand to generated seed `exec.mjs` for validating JSONL data against schema definitions without deploying. Add `@tailor-platform/sdk/seed` export that provides `defineSchema` (re-exported from `@toiroakr/lines-db`) and `validateSeedData` wrapper to avoid phantom dependency issues.
