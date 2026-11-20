---
"@tailor-platform/sdk": minor
---

Add `{ create: value }` secret values to `defineSecretManager()`. `tailor deploy` creates such a secret only when it does not exist yet and leaves an existing one unchanged, so a value generated once per environment, such as an encryption key, keeps its value across deploys.
