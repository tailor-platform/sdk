---
"@tailor-platform/sdk": minor
---

Add `validate` subcommand to generated seed `exec.mjs` for validating JSONL data against schema definitions without deploying. Add `@tailor-platform/sdk/seed` export that consolidates seed-specific utilities (`defineSchema`, `createTailorDBHook`, `createStandardSchema`, `validateSeedData`) and re-exports `@toiroakr/lines-db` to avoid phantom dependency issues.
