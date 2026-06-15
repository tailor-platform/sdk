---
"@tailor-platform/sdk": minor
---

Add `TailorPrincipal`, a unified type for the caller, actor, and invoker of a function execution.

The principal types are deprecated in favor of it and unified into `TailorPrincipal` (with absence represented as `null`) in the next major version:

- `TailorUser`, `TailorInvoker`, and the `unauthenticatedTailorUser` constant (including the one from `@tailor-platform/sdk/test`).
- The event executor `actor` value, whose `userId`/`userType` fields become `id`/`type` with `"user"`/`"machine_user"` values.
