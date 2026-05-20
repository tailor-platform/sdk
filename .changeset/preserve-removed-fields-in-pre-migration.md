---
"@tailor-platform/sdk": patch
---

Fix `tailordb migration`: removed fields (`field_removed`) are now temporarily kept on the type during the Pre-migration phase, so that `migrate.ts` can still read them — for example, to `innerJoin` through a foreign key that is being dropped in the same migration. The physical column is dropped in the Post-migration phase as before. Previously the column was dropped before `migrate.ts` ran, causing `field 'X' not found` errors when scripts referenced soon-to-be-deleted columns.
