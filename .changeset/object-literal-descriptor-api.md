---
"@tailor-platform/sdk": major
---

TailorDB API refactor: object-literal descriptor API and record-level hooks/validate

- **New**: `createTable(name, fields, options?)` accepts object-literal field descriptors alongside the existing fluent API.
- **New**: Resolver fields accept object-literal descriptors.
- **Breaking**: Removed field-level `.hooks()` and `.validate()` from the TailorDB field builder (`db.string().hooks(...)`, `db.int().validate(...)`, etc.) and from field descriptors passed to `createTable`.
- **Breaking**: `createTable` type-level `hooks` / `validate` options are now **record-level** callbacks that receive the full record via `({ data, user }) => ...`. Hooks return an object containing **only the fields to override**; omitted fields keep their incoming values. The SDK statically extracts the override key set from the returned object literal and expands each entry into a field-level hook on the affected field, so the platform-generated GraphQL `CreateInput` treats those fields as optional. `validate` accepts a single function, a `[fn, message]` tuple, or an array of either.

Migration: move field-level hook/validate logic into record-level callbacks on the type. Record-level hook bodies must end in a static object literal (`({ data }) => ({ k1: v1, k2: v2 })`) so the override keys can be statically resolved; branched or computed return shapes will throw at parse time.
