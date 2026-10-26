---
"@tailor-platform/sdk": minor
---

The PGlite schema from `kyselyTypePlugin` and the `db.pglite.ts` written for a migration now reject deleting a parent, or changing the key a row points at, while a row still points at it through an array field or a field inside a nested object, as the platform does. A test that deletes a parent before the rows pointing at it now fails with `violates foreign key constraint`; delete the child rows first.
