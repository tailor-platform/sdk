---
"@tailor-platform/sdk": patch
---

The SDK now rejects a relation whose field type differs from the type of the field it points at, such as a `db.string()` field related to `id`, and a `toward.key` that the target table does not have. The platform accepted a `db.string()` field related to `id`, but every non-null value written to it and every delete on the referenced table failed with `internal error`. To fix such a relation, remove its `.relation()`, or give the field the type of the field it points at.
