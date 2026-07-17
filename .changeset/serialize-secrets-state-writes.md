---
"@tailor-platform/sdk": patch
---

Fix concurrent deploys to the same workspace and application corrupting the local secrets hash state. Secret and auth-connection updates now hold a target-scoped lock while writing remote values and saving their hashes, so a later deploy no longer skips a secret update based on a hash that no longer matches the deployed value.
