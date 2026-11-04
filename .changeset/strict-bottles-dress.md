---
"@tailor-platform/sdk": patch
---

Apply local TailorDB table definitions that the pending migrations do not include in the same `tailor deploy --no-schema-check` run, once the migrations complete, instead of leaving them to the next deploy. The deploy lists those tables, and fails with `MIGRATION_LOCAL_DEFINITIONS_FAILED` after the migrations are applied when one of them cannot be applied.
