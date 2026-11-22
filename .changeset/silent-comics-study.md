---
"@tailor-platform/sdk": minor
---

A machine user can be written as `<auth>/<name>` to name its Auth service: in `--machine-user`, `TAILOR_PLATFORM_MACHINE_USER_NAME`, a profile's machine user, the name `tailor machineuser token` takes, and `migration.machineUser`; `tailor oauth2client get` takes `<auth>/<client>` the same way. A profile that pins a machine user also accepts the pinned user written this way. `startWorkflow()` takes `invoker: { namespace, machineUserName }`, and so does the `machineUserName` option of `seedPlugin()`. `tailor machineuser list` and `tailor oauth2client list` show the Auth service of each entry (`authNamespace` in `--json`), and `loadSeedContext()` also returns `resolveMachineUser()` to find a machine user's Auth service.
