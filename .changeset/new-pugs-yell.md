---
"@tailor-platform/sdk": patch
---

`tailor remove` now stops with `SERVICE_IN_USE` before it deletes anything when another application still references an Auth service the removed application defines. Before, removal deleted the application with its executors, workflows, resolvers and Auth machine users, and then failed on the Auth service, because the Platform refuses to delete an Auth service another application uses, which left the application half removed. Remove the referencing applications first, or deploy them without the Auth service. `SERVICE_IN_USE` from both `tailor deploy` and `tailor remove` lists every application that still uses the Auth service.
