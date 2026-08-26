---
"@tailor-platform/sdk": patch
---

Stop publishing TailorDB record events while migrations run. A migration script writes records through the platform, so a table with a subscribing executor emitted events from a shape that was mid-migration to executors still registered from the previous deploy. `deploy` now applies the migrating tables with publishing off and turns it back on once the migrations have settled.
