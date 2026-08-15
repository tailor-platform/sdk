---
"@tailor-platform/sdk": minor
---

`defineAIGateway()`'s `authNamespace` is now optional, defaulting to the application's own Auth service (local or external) — the common case, since an AI Gateway usually authenticates against its own app's auth. To authenticate against a different application's Auth service, reference it via `auth: { name, external: true }` and let `authNamespace` default to it, the same way a local `defineAuth()` does. Once `tailor.d.ts` is generated, `authNamespace` is type-narrowed to your application's own auth namespace name; register additional names via `declare module "@tailor-platform/sdk" { interface AuthNamespaceNameRegistry { ... } }` only if you need to set `authNamespace` explicitly to a namespace your own `auth` doesn't reference.
