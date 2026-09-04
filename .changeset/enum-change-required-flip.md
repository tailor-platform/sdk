---
"@tailor-platform/sdk": patch
---

Fix the generated migration `db.ts` for an enum field whose allowed values change in the same migration as its required-ness: the write slots now follow the post-migration schema, so making the field required rejects `null` in `migrate.ts`, and making it optional accepts `null`. When an emptied enum becomes optional, the scaffolded `migrate.ts` writes `null` for the removed values instead of a `"NEW_VALUE"` placeholder.
