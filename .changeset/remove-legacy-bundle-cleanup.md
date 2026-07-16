---
"@tailor-platform/sdk": patch
---

`tailor deploy` no longer automatically deletes on-disk bundle artifacts left by SDK versions predating the in-memory bundling approach; delete your output directory manually if stale files remain from a very old SDK version
