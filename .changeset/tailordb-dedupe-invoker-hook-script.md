---
"@tailor-platform/sdk": patch
---

Fix `tailordb deploy`/`migrate` failing with `type_hook.create.expr: must be at most 10000 characters` on TailorDB types with many field hooks. The invoker-normalization snippet is now generated once per type instead of once per hook.

Since generated hook/validate script text changes for any type with hooks, the first `tailordb migration generate` after upgrading will report a script update for those types even without any code changes on your side — this is expected and required for the fix to take effect.
