---
"@tailor-platform/sdk": patch
---

Report moving a relation to another key of the same table as a breaking change in `tailor tailordb migration generate` and scaffold the repair of the stored references in `migrate.ts`; the same change on a field inside `db.object()` is rejected, as moving it to another table already was
