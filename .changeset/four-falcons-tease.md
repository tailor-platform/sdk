---
"@tailor-platform/sdk": patch
---

Add validation error when `.unique()` is combined with `n-1` (manyToOne) relation. Use `1-1` (oneToOne) relation instead for unique foreign keys.
