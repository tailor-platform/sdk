---
"@tailor-platform/sdk": minor
---

Improve `tailordb migration` handling of data-loss-possible changes:

- Removed fields (`field_removed`) and removed types (`type_removed`) are now reported as **warnings** during `tailordb migration generate`, not silent changes. They are no longer dropped before `migrate.ts` runs: the field/type stays available during the Pre-migration phase so that scripts can read it (e.g. `innerJoin` through a foreign key that is being dropped in the same migration), then the physical drop happens in the Post-migration phase.
- Add `tailordb migration script <number>` subcommand to add a `migrate.ts` (and `db.ts`) template to an existing migration directory. Useful for warning-tier changes where you want a custom data migration even though one was not generated automatically.
- `migrate.ts` is now executed whenever the file exists on disk for a pending migration, regardless of whether the diff originally required a script. Breaking changes still hard-require a script as before.
