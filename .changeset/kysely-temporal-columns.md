---
"@tailor-platform/sdk": minor
---

Add a `temporal` option to `kyselyTypePlugin`. When enabled, `date`/`datetime`/`time` TailorDB columns resolve to `Temporal.PlainDate`/`Temporal.Instant`/`Temporal.PlainTime` (instead of `Date`/`string`) in generated Kysely types, `getDB()`, and migration `db.ts` files, matching a `tailordb.Client` created with `{ temporal: true }`. Migration scripts now run against a `tailordb.Client` configured with the same `temporal` setting, so the runtime values a migration script sees always match its generated types.
