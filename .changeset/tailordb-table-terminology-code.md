---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: Rename the remaining TailorDB identifiers that named a `db.table()` definition a type:

- record trigger config `typeName` → `tableName`
- `PluginRecordTriggerConfig.typeName` → `tableName`
- generator auth input `userProfile.typeName` → `tableName`
- `mockFile().calls[]` entries expose `tableName`
- `tailordb.file` runtime parameters and their JSDoc

Update custom plugins that build a record trigger config, and test assertions that read `mockFile().calls[].typeName`. Executor runtime args keep `typeName`, since that is the key the platform sends into a deployed executor; the proto `type_name` wire field, TRN `type` segments, and the `.typeName()` field builder are unchanged.
