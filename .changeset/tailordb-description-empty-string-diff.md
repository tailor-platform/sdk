---
"@tailor-platform/sdk": patch
---

fix(deploy): stop reporting persistent TailorDB type diffs on every `deploy`. Fields without a `description` are emitted as an empty string by the platform but omitted by the local manifest; the comparison now treats an empty-string `description` as unset (same handling as empty `expr`), so unchanged types are no longer flagged as updates on repeated applies.
