---
"@tailor-platform/sdk": minor
---

`@tailor-platform/sdk/cli` exports `lockVersionFor()` and `parseLockWorkspaces()` for `.github/tailor.lock`, and the beta `loadConfigFile()`, which loads `tailor.config.ts` and its plugins for SDK plugins that read the config themselves.

`TAILOR_LOCK_VERSION` is now 3, the newest lock version the SDK reads. A lock that records no workspace config is still written as version 2, so older SDKs keep reading it.
