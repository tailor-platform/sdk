---
"@tailor-platform/sdk": patch
---

Fix generated migrate.ts templates for enum value removal: removed enum values were compared by object identity (so unchanged values were also treated as removed) and rendered as `[object Object]` in the generated migration script.
