---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
---

Unify function principal context around `TailorPrincipal`.

Resolver contexts now use `caller` and `invoker` as `TailorPrincipal | null`, workflow and executor invokers also use `TailorPrincipal | null`, and event executor `actor` uses `TailorPrincipal | null` with `id`/`type` fields. The legacy `TailorUser`, `TailorInvoker`, `TailorActor`, `TailorActorType`, and `unauthenticatedTailorUser` exports are removed.
