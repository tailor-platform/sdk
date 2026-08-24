---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": minor
---

`.relation()`'s `toward.type` option is renamed to `toward.table`, since it names a target table rather than a TypeScript/GraphQL type — matching the `db.type()` → `db.table()` rename. The old spelling keeps working as a deprecated alias until v3; `tailor upgrade` offers the `v3/relation-toward-table` codemod to rewrite `toward: { type: ... }` to `toward: { table: ... }` across TypeScript/JavaScript sources. The relation's own `type` (its cardinality, e.g. `"n-1"`) is unchanged.
