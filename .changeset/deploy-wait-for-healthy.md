---
"@tailor-platform/sdk": minor
---

`tailor-sdk deploy` now waits for the application's GraphQL schema composition to succeed before returning. Composition errors that previously only surfaced via `tailor-sdk workspace app health` are now raised by `deploy` itself.
