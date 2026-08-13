---
"@tailor-platform/sdk": patch
---

Fix `tailordb deploy`/`migrate` failing with `type_hook.create.expr: must be at most 10000 characters` on TailorDB types with many field hooks. The invoker-normalization snippet is now generated once per type instead of once per hook.
