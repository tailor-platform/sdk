---
"@tailor-platform/sdk": patch
---

Fix hints for a multi-step migration left in progress that said completed steps never run again: they now note that adding, removing, or renaming a step, or changing the order the steps run in, runs every step again
