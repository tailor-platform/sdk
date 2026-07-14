---
"@tailor-platform/sdk": patch
---

Correct the execution policy matching semantics in the workflow docs: overlapping policies now stack (every matching cap is enforced independently and the tightest blocks), not longest-prefix-wins.
