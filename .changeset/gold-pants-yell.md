---
"@tailor-platform/sdk": patch
---

The SDK now rejects a relation whose field type differs from the field it points at, such as a `db.string()` field related to `id`, and a `toward.key` that the target table does not have. The platform accepted a `db.string()` field related to `id`, but every non-null value written to it and every delete on the referenced table failed with `internal error`. Remove the `.relation()` from such a field, or change the field to `db.uuid()`.
