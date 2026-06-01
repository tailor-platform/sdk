---
"@tailor-platform/sdk": minor
---

Add `createMockKysely` to `@tailor-platform/sdk/vitest` for unit-testing code that uses a Kysely `Transaction` directly. It returns a real Kysely instance whose execution is mocked, so queries stay fully typed and compile to the same SQL as production. Stage results with `enqueueResults` / `setQueryResolver` and assert operation counts via the `inserts` / `updates` / `deletes` / `selects` getters, without the `tailor-runtime` environment.
