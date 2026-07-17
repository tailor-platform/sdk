---
"@tailor-platform/sdk": patch
---

`tailor deploy` no longer automatically deletes on-disk bundle artifacts left by SDK versions predating the in-memory bundling approach; delete those specific stale files manually if any remain from a very old SDK version (do not delete the whole output directory, which also holds deploy state such as secrets and Auth Connection records)
