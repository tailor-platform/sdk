---
"@tailor-platform/sdk": patch
---

`createKyselyMock`: assert what a write wrote as a `{ column: value }` map instead of positional SQL parameters. On a recorded query:

- `insertValues()` / `insertRows()` — the values a single- / multi-row insert wrote
- `updateValues()` — the values an update's SET clause wrote
- `node` — the raw Kysely operation node, for anything the helpers don't cover

Also adds `withTx(fn)` to run `fn` inside a real `Transaction`.
