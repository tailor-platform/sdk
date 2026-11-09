---
"@tailor-platform/sdk": patch
---

`tailor remove` now also stops with `SERVICE_IN_USE` before it deletes anything when another application still references an Auth service it would delete, and both `tailor deploy` and `tailor remove` stop the same way for a TailorDB namespace or resolver namespace that another application references as `external`. The error lists every application that uses each service. Before, they deleted the namespace's tables (with their data) or resolvers, or the Auth service's machine users, and then failed on the namespace or Auth service itself, because the Platform refuses to delete one that another application uses, which left the workspace half applied. Keep the resource in the config that defines it, or first remove the referencing applications or deploy them without it.
