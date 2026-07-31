---
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk": patch
---

Fix `tailor seed apply --upsert` for the Built-In IdP `_User` entity: a seed row with no attributes beyond `name` is now counted as skipped instead of triggering a no-op update, no success line is printed when every `_User` row fails, and a lookup failure is no longer swallowed when the following create also fails (the error now reports both). Also documents that `--upsert` updates run through the same update path as any other write, so update hooks, validation, and `recordUpdatedTrigger` executors apply to updated rows.
