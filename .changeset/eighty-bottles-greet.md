---
"@tailor-platform/sdk": minor
---

**Beta:** `@tailor-platform/sdk/cli` exports `loadConfigFile()`, which loads a `tailor.config.ts` of any kind, and `lockVersionFor()` and `parseLockWorkspaces()` for `.github/tailor.lock`. `TAILOR_LOCK_VERSION` is now 3, the newest lock version the SDK reads; a lock without workspace configs is still written as version 2.
