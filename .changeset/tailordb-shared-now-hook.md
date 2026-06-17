---
"@tailor-platform/sdk": minor
---

Add a `now` argument to TailorDB hooks. `now` is the operation timestamp and is shared across every field hooked in the same create/update, so multiple fields can be stamped with an identical `Date`. Hooks and validators are now applied per type rather than per field, which is what makes the shared timestamp possible.

As part of this, all of a type's hooks now run together and observe the same submitted input: a hook's `data` reflects what the client sent and does not include other fields' hook results.
