---
"@tailor-platform/sdk": minor
---

`kyselyTypePlugin`'s `pgliteSchemaPath` script now enforces relations: a row pointing at a parent that does not exist is rejected, as on the platform. Tests that insert child rows before their parents must create the parents first.

A relation to a field other than `id` that is not unique, or whose type differs from the referencing field, fails generation, as the platform rejects it on deploy.
