---
"@tailor-platform/sdk": minor
---

`@tailor-platform/sdk/cli` now exports `appIdLockKey` and `resolveAppId`, so a CLI plugin can read a config's application id the same way `deploy` does — preferring the id recorded in `.github/tailor.lock`, falling back to the id the config module evaluates to. `resolveAppId` never writes the lock, edits the config, or prompts, and resolves to `undefined` without warning when neither source has an id.
