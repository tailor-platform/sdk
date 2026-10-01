---
"@tailor-platform/sdk-plugin-setup": patch
---

The workflow template version now goes up by one per release that changes the generated workflows, instead of once per change. This release still reports every generated target as outdated in `tailor setup check`; run `tailor setup update` to regenerate them.
