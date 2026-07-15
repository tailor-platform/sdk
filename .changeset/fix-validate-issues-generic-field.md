---
"@tailor-platform/sdk": patch
---

Fix a spurious `TS2719` type error when a `db.table()` type built with custom fields is passed across module boundaries (e.g. into another package's factory function) and its `.validate()` callback's `issues()` field parameter is compared for assignability. The `issues()` field argument type no longer uses a self-generic parameter, so structurally-equal `TailorDBType` instances derived through different generic instantiation paths are recognized as compatible.
