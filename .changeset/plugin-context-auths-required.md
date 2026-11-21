---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: `TailorDBReadyContext`, `ResolverReadyContext`, and `ExecutorReadyContext` now require `auths`, so code that builds one of these contexts itself, such as a plugin test that calls a hook, fails to type-check until it adds `auths`: `{}` for a config without an Auth service, or `{ [auth.name]: auth }` for the one it passed as `auth`.
