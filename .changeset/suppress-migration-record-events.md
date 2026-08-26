---
"@tailor-platform/sdk": patch
---

Stop publishing TailorDB record events while migrations run. A migration script writes records through the platform, so a table that publishes emitted events from a shape that was mid-migration to executors still registered from the previous deploy. `deploy` now silences every publishing table in a migrating namespace — including one that declares `publishEvents: true` — and turns publishing back on once the migrations have settled, or before the error escapes if a migration fails.
