---
"@tailor-platform/sdk": major
---

TailorDB API refactor: object-literal descriptor API and record-level hooks/validate

- **New**: `createTable(name, fields, options?)` accepts object-literal field descriptors alongside the existing fluent API.
- **New**: Resolver fields accept object-literal descriptors.
- **Breaking**: Removed field-level `.hooks()` and `.validate()` from the TailorDB field builder (`db.string().hooks(...)`, `db.int().validate(...)`, etc.) and from field descriptors passed to `createTable`.
- **Breaking**: `createTable` type-level `hooks` / `validate` options are now **record-level** callbacks that receive the full record via `({ data, user }) => ...`. Hooks return an object containing **only the fields to override**; omitted fields keep their incoming values. `validate` accepts a single function, a `[fn, message]` tuple, or an array of either.
- **Breaking**: `db.fields.timestamps()` / `timestampFields()` now returns fields only — it no longer installs automatic `create` / `update` hooks. Define record-level hooks explicitly to populate `createdAt` / `updatedAt`.

Migration: move field-level hook/validate logic into record-level callbacks on the type.
