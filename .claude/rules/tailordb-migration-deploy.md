---
paths:
  - "packages/sdk/src/cli/commands/deploy/tailordb/**"
---

# TailorDB Migration Deploy Flow

`applyWithMigrations` (`apply.ts`) runs a deploy whose TailorDB namespaces have pending migrations, in this order:

1. `captureMigrationRestrictionState` reads the live table settings of the migrating namespaces into `flow.restrictionState`, and `loadPreMigrationSnapshots` rebuilds each namespace's schema at its checkpoint. `releaseRecordedMaintenanceModes` copies the captured settings into `flow.settingsBeforeMaintenanceMode`, releasing the maintenance mode an earlier deploy recorded at that checkpoint, and `restoration.settings` starts from this copy.
2. `applyChangesBeforeMigrations` applies the planned creates and updates outside the migrating namespaces. Inside them, it creates only the tables the checkpoint already has and no pending migration removes, in the checkpoint's shape, and records them in `processedTables.created`.
3. `runPendingMigrations` restricts the tables when maintenance mode is on, then runs each migration's Pre-phase, script and Post-phase. Each commit updates the checkpoint label, then deletes the tables the migration removes that the plan also deletes.
4. `verifyRestorationCheckpoints` checks that every checkpoint still belongs to this deploy.
5. Without a failure, `applyLocalDefinitions` (`--no-schema-check` only) creates the planned tables no earlier step created and writes the local definitions that differ from the last migration.
6. `keepPartialMigrationsRestricted` drops the tables of a partially applied migration from `restoration`. The restore (`restoreMigrationRestrictions`) then lifts the restrictions: right away through `restoreAfterMigrations`, or, with `maintenanceMode: "deploy"` and no failure, through `releaseHeldMaintenanceMode` after the rest of the deploy, which checks ownership again. A failure is thrown after this step.
7. `applyDeferredGqlPermissions`; `applyRemainingDeletions`, which deletes the remaining GraphQL permissions everywhere but tables only outside the migrating namespaces; then the metadata labels. With `"deploy"`, these run while the tables are still restricted.

Keep these invariants:

- **`restoration` decides the end state.** The restore is the last write of a migrating namespace's table definitions. It rewrites each table `restoration.settings` lists, in the shape `restoration.snapshots` gives it (the captured shape for a table outside the snapshot), and leaves every other table as it is. A step that changes the schema a migrating namespace ends at updates `restoration` to match, or the restore overwrites the change.
- **Unlisted tables stay as written.** A table written with `generateMigrationPhaseManifest` while maintenance mode is on stays restricted unless `restoration.settings` lists it when the restore runs. That is why the creates of `applyLocalDefinitions` use the plan request's final settings.
- **Ownership before writes.** After `runPendingMigrations`, write to a migrating namespace only once `verifyRestorationCheckpoints` has run, and only while `restoration.snapshots` still has the namespace: the check removes a namespace whose checkpoint another deploy changed or that it could not read.
- **Shared objects.** `restoration.snapshots` holds the objects of `flow.preMigrationSnapshots` and `migrationSnapshotCache.load()`, and the inner maps of `restoration.settings` are those of `flow.settingsBeforeMaintenanceMode`, which shares the ones it does not release with `flow.restrictionState`. Store a new snapshot or map instead of changing one.
- **Module-level run state.** `processedTables` (keyed by `namespacedTableKey`) and `deletedResources` (`migration-execution.ts`) record what this deploy already wrote so later steps skip it. Each deploy resets them.
- **Write order.** Within a step, creates go before updates: an update can add a relation to a table a create adds.
- **Documented phases.** `flow.timeline` attributes maintenance time to the phases in `migration-timing.ts`. When a step moves between phases, update the phase table under "Time spent in maintenance mode" in `packages/sdk/docs/services/tailordb/migration.md`.

Tests built with `createPlanResult` (`test-helpers/migration-apply.ts`) run under `--no-schema-check` unless they pass `context: { noSchemaCheck: false }`. Without `local`, the namespace has no deploy input, so the restrict and restore steps skip it.
