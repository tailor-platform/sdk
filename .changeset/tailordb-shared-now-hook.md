---
"@tailor-platform/sdk": minor
---

Redesign TailorDB hooks and validators with several breaking changes (pre-release):

- Add shared `now` timestamp to all hooks — multiple fields stamped with the same `Date`
- Field-level hooks: `{ value, data, invoker }` → create `{ value, invoker, now }` / update `{ value, oldValue, invoker, now }` (`data` removed, `oldValue` added for update only)
- Type-level hooks: per-field mapping (`Hooks<F>`) → single `{ create, update }` object (`TypeHook<F>`) returning partial field overrides
- Type-level create hooks no longer receive `oldRecord`; update hooks receive non-nullable `oldRecord`
- Field-level validators: return type changed from `boolean` to `string | void` (return error message or void to pass); `[fn, message]` tuple form removed
- Type-level validators: `Validators<F>` per-field record → `TypeValidateFn<F>` single function with `issues(field, message)` callback
- Add `.default(value)` on fields to set a create-time default (makes required fields optional in create input)
- Remove exported types: `Hooks<F>`, `Validators<F>`, `ValidateConfig`
