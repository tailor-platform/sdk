---
"@tailor-platform/sdk": patch
---

Fix a type error introduced in a previous release where an array field's `.index()`/`.unique()`/`.clone()`/`pickFields()` typing could become incompatible with itself when a field's shape flowed through an unresolved generic (e.g. a module-authoring helper's `ReturnType<typeof genericFn>` with no explicit type arguments). This could surface as a spurious `TS2322`/`TS2345` type error when wiring a `db.type()` result produced by one generic helper into another.
