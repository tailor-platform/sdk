---
"@tailor-platform/sdk": minor
---

Add `TailorPrincipal`, a unified type for the caller, actor, and invoker of a function execution. `TailorUser`, `TailorActor`, `TailorInvoker`, and the `unauthenticatedTailorUser` constant are now deprecated and will be unified into `TailorPrincipal` (with absence represented as `null`) in the next major version.
