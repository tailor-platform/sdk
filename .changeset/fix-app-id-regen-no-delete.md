---
"@tailor-platform/sdk": patch
---

Fix `deploy` to no longer delete the application when its `id` is regenerated
(e.g. CI working tree without a committed `id` in `tailor.config.ts`).
