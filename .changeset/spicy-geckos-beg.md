---
"@tailor-platform/sdk": patch
---

Fix hints for a multi-step migration left in progress that claimed completed steps never run again. They now say that completed steps run again when you add, remove, or rename a step, change the order the steps run in, or the earlier run was canceled or is no longer available.
