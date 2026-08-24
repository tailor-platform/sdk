---
"@tailor-platform/sdk": patch
---

`TAILOR_APPLY_CONCURRENCY` and `TAILOR_BUNDLE_CONCURRENCY` now fall back to their defaults when set to a value above `Number.MAX_SAFE_INTEGER`, instead of being honored as an effectively unlimited cap. Values with leading zeros (`0007`) are now accepted.
