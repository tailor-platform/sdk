---
"@tailor-platform/sdk": patch
---

Adding a relation to an existing field is now a breaking change in `tailor tailordb migration generate`, and the migration needs a script. It was recorded as non-breaking, so values that point at no record stayed stored, and after deploy the platform rejected any later update of those rows, even one that changes another field. The generated `migrate.ts` finds those values and asks for their new reference with `TODO`, or leaves the elements of an array field to a single `TODO`. The foreign key is applied after the script runs, so the script and the other steps of the migration can update those rows. A relation added to a field inside `db.object()` stays non-breaking. The script generated for a relation retargeted to another table now also works when the relation points at its own table or at a key other than `id`.
