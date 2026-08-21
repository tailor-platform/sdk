---
"@tailor-platform/sdk": patch
---

Skip reloading resolver files when a namespace's resolvers were already loaded but yielded none, avoiding duplicate imports and log output.
