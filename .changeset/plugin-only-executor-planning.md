---
"@tailor-platform/sdk": patch
---

Fix deploy planning dropping plugin-generated executors when the project defines no executor files of its own, which could omit them from deployment or delete an already-deployed one
