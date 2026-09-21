---
"@tailor-platform/sdk": minor
---

`@tailor-platform/sdk/cli` now exports `appIdLockKey` and `resolveAppId`, so a CLI plugin can read a config's application id the same way `deploy` does — preferring the id recorded in `.github/tailor.lock`, falling back to the id the config module evaluates to. `resolveAppId` never writes the lock, edits the config, or prompts, and resolves to `undefined` without warning when neither source has an id. A config id that disagrees with the lock, or that already belongs to a different, still-existing config, throws `APP_ID_CONFLICT` instead of guessing.
