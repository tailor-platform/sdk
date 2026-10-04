---
"@tailor-platform/sdk": minor
---

Add a `temporal` option to `kyselyTypePlugin`. When enabled, `date`/`datetime` fields and top-level `time` fields resolve to `Temporal.PlainDate`/`Temporal.Instant`/`Temporal.PlainTime` (instead of `Date`/`string`) in generated Kysely types, migration `db.ts` files, and `tailor function script` types, and the generated `getDB()` reads them back as those values. Nested `time` fields remain strings. The mode is fixed by the plugin setting; `getDB()` takes no `temporal` option.

Each migration records whether its `db.ts` was generated with Temporal types, and deploy runs that migration's script in the same mode, so migrations generated before `temporal` was enabled keep receiving `Date` values. Migration files are now written as format version 7, which older SDK versions refuse to read. `mockTailordbWithPGlite` and `createKyselyPGlite` (with `{ temporal: true }`) return Temporal values from PGlite to match, and accept Temporal values as query parameters.
