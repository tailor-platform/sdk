---
"@tailor-platform/sdk": patch
---

Fix resolver field builders (`t.*`) leaking metadata between fields. `description()`, `typeName()`, and `validate()` now return a new field instead of mutating the original, so a field instance reused across places (for example shared between a resolver's `input` and `output`, or a record passed to `t.object`) no longer leaks its metadata into the other usages. This matches the existing `db.*` behavior.
