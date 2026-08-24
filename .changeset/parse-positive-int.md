---
"@tailor-platform/sdk": patch
---

`TAILOR_APPLY_CONCURRENCY` and `TAILOR_BUNDLE_CONCURRENCY` now fall back to their defaults when set above `Number.MAX_SAFE_INTEGER`. Such values were previously used as-is, which silently lifted the concurrency cap or applied a rounded number that did not match what was set. Values with leading zeros (`0007`) are now accepted.
