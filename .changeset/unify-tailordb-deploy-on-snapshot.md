---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy` so decimal fields without an explicit `scale` no longer show spurious drift against the platform (which materializes the default `6`). Deploy now plans and applies through the same snapshot pipeline as `tailordb migrate`.
