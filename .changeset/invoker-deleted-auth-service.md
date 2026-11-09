---
"@tailor-platform/sdk": patch
---

`tailor deploy` now stops with `SERVICE_IN_USE` before it applies anything when the deploy would delete an Auth service that an application still references as `external`. Before, such a deploy deleted the Auth service's machine users and then failed on the Auth service itself, because the Platform refuses to delete an Auth service another application uses, which left the workspace half applied. This covers applications in the same deploy and applications that the deploy does not include. Keep the Auth service in the config that defines it, or move the referencing application to another Auth service in the same deploy.
