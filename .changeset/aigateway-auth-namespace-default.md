---
"@tailor-platform/sdk": minor
---

`defineAIGateway()`'s `authNamespace` is now optional, defaulting to the application's own Auth service — the common case, since an AI Gateway usually authenticates against its own app's auth. It stays overridable when the gateway needs to authenticate against a different application's auth namespace instead. `tailor.d.ts` now suggests the application's auth namespace name via autocomplete on `authNamespace`.
