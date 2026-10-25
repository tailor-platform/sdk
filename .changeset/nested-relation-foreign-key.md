---
"@tailor-platform/sdk": minor
---

A relation set on a field inside `db.object()` now becomes a foreign key on that inner field, in the deployed schema and in the PGlite schema `kyselyTypePlugin` generates. Before, the relation was accepted but had no effect, so a row pointing at a missing parent was stored. For a project that already has such a relation, the next `tailor deploy` stops with a schema check error until you run `tailor tailordb migration generate`, which records one non-breaking `field_modified` change. Values already stored are not checked when the foreign key is added; after that deploy, the platform rejects a nested value that points at a missing parent.
