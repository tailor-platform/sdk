---
"@tailor-platform/sdk": minor
---

**Breaking change**: The SDK now rejects a relation whose field type differs from the type of the field it points at, such as a `db.string()` field related to `id`, and a `toward.key` that the target table does not have or that is not unique. A `db.string()` field related to `id` deployed, but `tailor query --engine sql` failed with `internal error` when inserting a non-null value into it and when deleting any row of the referenced table. Through GraphQL, a non-UUID value failed with `unknown error`, and a child holding an uppercase UUID did not stop its parent's deletion. To fix such a relation, remove its `.relation()`, or change the field to the type of the field it points at (`db.uuid()` for `id`) and convert its stored values as "Converting a field type" in the TailorDB migration docs describes.
