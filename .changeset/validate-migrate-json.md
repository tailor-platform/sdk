---
"@tailor-platform/sdk": patch
---

Corrupted or hand-edited TailorDB migration snapshot/diff files now fail with a clear validation error when loaded, instead of causing undefined behavior later.
