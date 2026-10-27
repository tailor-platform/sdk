---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: A query issued on a `createKyselyPGlite` instance while one of its transactions is open now waits for the transaction to finish. Before, the query ran inside the transaction, and when it failed, the commit silently discarded the transaction's writes. A query on the outer instance from inside the transaction now never finishes and the test times out; run it on `trx` instead.
