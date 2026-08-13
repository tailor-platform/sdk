---
"@tailor-platform/sdk": patch
---

TailorDB schema snapshots now keep their tables under a `tables` key instead of `types`, completing the `db.type()` → `db.table()` rename. Committed migration histories keep replaying: a legacy `types` key in `schema.json` is still read and moved on load, so no migration files need editing. Migration file format version is now 5 and this SDK reads versions 1 through 5.

Code that imports `SchemaSnapshot` or `NormalizedSchemaSnapshot` from `@tailor-platform/sdk/cli` and reads `snapshot.types` no longer compiles:

```ts
Object.keys(snapshot.types); // before
Object.keys(snapshot.tables); // after
```

This also applies to the snapshots returned by `compareSnapshots`, `createSnapshotFromLocalTypes`, `reconstructSnapshotFromMigrations`, and `compareLocalTypesWithSnapshot`.

The `types` key on parsed TailorDB service config is a different thing and is unchanged.
