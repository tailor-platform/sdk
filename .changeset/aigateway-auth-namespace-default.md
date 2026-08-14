---
"@tailor-platform/sdk": minor
---

`defineAIGateway()`'s `authNamespace` is now optional, defaulting to the application's own Auth service — the common case, since an AI Gateway usually authenticates against its own app's auth. Once `tailor.d.ts` is generated, `authNamespace` is type-narrowed to the application's own auth namespace name; to authenticate against a different application's Auth service instead, register its name via `declare module "@tailor-platform/sdk" { interface AuthNamespaceNameRegistry { ... } }`.
