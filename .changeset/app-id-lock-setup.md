---
"@tailor-platform/sdk-plugin-setup": minor
---

`tailor setup` records the app id in the `appIds` section of `.github/tailor.lock` instead of injecting it into `tailor.config.ts`, and moves an existing config `id` into the lock. The lock format is now version 2; update this plugin together with `@tailor-platform/sdk`, since older plugin versions refuse to rewrite a version 2 lock instead of dropping the section.
