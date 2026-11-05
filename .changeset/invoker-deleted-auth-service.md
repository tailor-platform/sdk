---
"@tailor-platform/sdk": patch
---

`tailor deploy` now stops with `INVOKER_MACHINE_USER_NOT_FOUND` when a string `invoker` of a resolver or an executor refers to an Auth service that the same deploy deletes, including the resolvers and executors of other apps in the workspace that the deploy does not include. Before, a config that referenced an Auth service as `external` passed the check while the config that defined that Auth service was removed from the same run, and the machine users disappeared when the deploy applied. Keep the Auth service in the config that defines it, or point the invoker at another Auth service.
