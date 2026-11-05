---
"@tailor-platform/sdk": patch
---

`tailor seed apply` now runs each seed chunk in a single transaction. If any table fails, every table inserted earlier in that chunk is rolled back instead of being left committed, and Executors triggered by create events no longer run mid-chunk, which could deadlock on self-referencing tables.

Seed data is split into chunks of about 3.5 MiB, and the transaction covers one chunk. A table that does not fit in one chunk is split across chunks and is committed chunk by chunk.
