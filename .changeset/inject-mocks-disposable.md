---
"@tailor-platform/sdk": minor
---

`injectMocks()` from `@tailor-platform/sdk/vitest` now returns a `Disposable` that removes the installed platform globals, so tests can acquire it with a `using` declaration instead of pairing it with a manual `cleanupMocks()` call
