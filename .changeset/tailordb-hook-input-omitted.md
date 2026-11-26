---
"@tailor-platform/sdk": patch
---

Type the `input` of TailorDB hooks with the values the Platform passes when a create or update leaves a field out. A field's `.hooks()` `create` and `update` receive `undefined` for a field the input leaves out, and `null` only when the input sets it to null, so `input` is now `T | null | undefined`. In a table's `.hooks()` `create`, `input` has `id` only when the input sets one (`string | null | undefined`), has an optional field only when the input sets it or a field hook or default fills it, and no longer lists `.serial()` fields.

Some code that type-checked before now fails type checking:

- A hook that checks `input !== null` before using the value, uses `input.id` as a string, or reads a `.serial()` field. Once deployed, such code threw or read `undefined` when the input left the field out. Check `input != null` (or `input.id != null`) first, and drop reads of `.serial()` fields.
- A hook whose `input` parameter is annotated as `T | null`, or code that passes `input`, or an optional field of a table create hook's `input`, where `T | null` is expected. Widen the type to `T | null | undefined`.
- A hook on an optional field that returns `input` as is. In an update hook, return `input ?? oldValue` to keep the stored value when the update leaves the field out; returning `null` clears it.
