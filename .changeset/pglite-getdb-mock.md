---
"@tailor-platform/sdk": minor
---

Add `mockTailordbWithPGlite` to `@tailor-platform/sdk/vitest`: back `getDB(namespace)` with an in-memory PostgreSQL (`@electric-sql/pglite`), so resolver/executor/workflow tests execute their queries against real data instead of staged responses
