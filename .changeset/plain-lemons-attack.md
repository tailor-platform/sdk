---
"@tailor-platform/sdk-plugin-seed": minor
---

`tailor seed apply` and `tailor seed dump` take `--machine-user <auth>/<name>` to name the machine user's Auth service, and find the Auth service from the config instead of reading the deployed application. They need an SDK version whose `loadSeedContext()` returns `resolveMachineUser()`.
