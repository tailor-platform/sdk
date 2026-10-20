---
"@tailor-platform/sdk": minor
---

The `db.pglite.ts` that `tailor tailordb migration generate` writes now enforces relations: a row pointing at a parent that does not exist is rejected, as on the platform. Migration tests that stage child rows before their parents must create the parents first. A relation the pre-migration schema cannot satisfy, such as a field whose type change is still pending, is left unenforced.
