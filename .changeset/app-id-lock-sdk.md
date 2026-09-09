---
"@tailor-platform/sdk": minor
---

Record the app id in `.github/tailor.lock` instead of `tailor.config.ts` for projects that use `tailor setup`. `deploy` and `remove` read the id from the lock's new `appIds` section, keyed by the config file path, so renaming the app or copying a config inside the repo no longer risks claiming another app's resources. A local `tailor deploy` moves an existing config `id` into the lock and removes it from `tailor.config.ts`; in CI a config without a recorded id fails at plan time with instructions. Projects without the lock keep the current behavior.
