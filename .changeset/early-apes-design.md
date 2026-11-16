---
"@tailor-platform/sdk": patch
---

`tailor deploy` now stops with `AUTH_MACHINE_USER_NOT_FOUND` before it changes anything when an Auth service's `scim.machineUserName` or `hooks.beforeLogin.invoker` names a machine user that its `machineUsers` does not list. Before, it deployed the SCIM config or login hook anyway, naming a machine user that the Auth service does not have, and deleted that machine user when the config had dropped it from `machineUsers`. To deploy such a config, add the machine user to `machineUsers`.
