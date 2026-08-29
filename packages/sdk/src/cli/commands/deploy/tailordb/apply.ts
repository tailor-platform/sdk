import * as path from "pathe";
import {
  getNamespacesWithMigrations,
  type NamespaceWithMigrations,
} from "#/cli/commands/tailordb/migrate/config";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
import { fetchRemoteMigrationState } from "#/cli/commands/tailordb/migrate/remote-state";
import {
  reconstructSnapshotFromMigrations,
  formatMigrationNumber,
  getLatestMigrationNumber,
  getMigrationFiles,
  type SchemaSnapshot,
  type TailorDBSnapshotType,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { generateTailorDBTypeManifestFromSnapshot } from "#/cli/commands/tailordb/migrate/snapshot-manifest";
import { handleOptionalToRequiredError } from "#/cli/commands/tailordb/migrate/types";
import { logger } from "#/cli/shared/logger";
import { withSpan } from "#/cli/telemetry/index";
import { resourceTrn, writeMetadataLabels } from "../label";
import { executeMigrations, updateMigrationLabel, type MigrationContext } from "./migration";
import {
  applyMigrationRestrictions,
  captureMigrationRestrictionState,
  deletedResources,
  executeSingleMigrationPostPhase,
  executeSingleMigrationPostPhaseDeletions,
  executeSingleMigrationPrePhase,
  restoreMigrationRestrictions,
  getDeletedTableNames,
  migrationSnapshotCache,
  processedTables,
  resolveMigrationSnapshotSettings,
  rollbackSingleMigrationAfterFailure,
} from "./migration-execution";
import {
  migrationFileStatesEqual,
  validateAndDetectMigrations,
  type ValidateAndDetectResult,
} from "./migration-validation";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { OperatorClient } from "#/cli/shared/client";
import type { TailorDBServiceConfig } from "#/types/tailordb.generated";
import type { ApplyPhase } from "../types";
import type { planTailorDB, TailorDBChangeSet, TailorDBPlanResult } from "./plan";

/**
 * Reconcile each namespace's migration checkpoint and history ID to
 * the working tree after a create-update apply.
 *
 * This records the initial baseline (`0000`), which is deployed via the normal
 * flow and never bumps the label itself, and keeps the label `<= working_tree_max`
 * after a `--no-schema-check` deploy from an older revision. Namespaces without a
 * baseline are skipped so no phantom label is written.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param namespacesWithMigrations - Namespaces that have migration directories configured
 * @param migrationHistoryIds - Migration history ID captured during preflight for each namespace
 */
async function reconcileMigrationLabels(
  client: OperatorClient,
  workspaceId: string,
  namespacesWithMigrations: NamespaceWithMigrations[],
  migrationHistoryIds: Readonly<Record<string, string | null>>,
): Promise<void> {
  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    if (getMigrationFiles(migrationsDir).length === 0) {
      continue;
    }
    const targetVersion = getLatestMigrationNumber(migrationsDir);
    const historyId = migrationHistoryIds[namespace] ?? null;
    const remoteState = await fetchRemoteMigrationState(
      client,
      resourceTrn(workspaceId, "tailordb", namespace),
    ).catch(() => null);
    const currentVersion = remoteState?.number ?? null;
    if (remoteState && currentVersion === targetVersion && remoteState.historyId === historyId) {
      continue;
    }
    await updateMigrationLabel(
      client,
      workspaceId,
      namespace,
      targetVersion,
      historyId ?? undefined,
    );
    if (remoteState) {
      logger.info(
        `Migration label for namespace ${namespace} reconciled: ${describeMigrationCheckpoint(currentVersion)} → ${formatMigrationNumber(targetVersion)}.`,
      );
    } else {
      logger.info(
        `Migration label for namespace ${namespace} reconciled to ${formatMigrationNumber(targetVersion)}.`,
      );
    }
  }
}

/**
 * Build migration execution context for script-based migrations.
 * @param client - Operator client instance
 * @param migrationContext - Planned TailorDB context
 * @param migrationsRequiringScripts - Migrations that require scripts
 * @returns Migration context for script execution
 */
function buildMigrationContextForScripts(
  client: OperatorClient,
  migrationContext: Awaited<ReturnType<typeof planTailorDB>>["context"],
  migrationsRequiringScripts: PendingMigration[],
): MigrationContext {
  const authService = migrationContext.application.authService;
  if (!authService) {
    throw new Error("Auth configuration is required to execute migration scripts.");
  }

  const dbConfigMap: Record<string, TailorDBServiceConfig | undefined> = {};
  for (const migration of migrationsRequiringScripts) {
    if (!(migration.namespace in dbConfigMap)) {
      dbConfigMap[migration.namespace] = migrationContext.config.db?.[migration.namespace] as
        | TailorDBServiceConfig
        | undefined;
    }
  }

  return {
    client,
    workspaceId: migrationContext.workspaceId,
    authNamespace: authService.config.name,
    machineUsers: authService.config.machineUsers
      ? Object.keys(authService.config.machineUsers)
      : undefined,
    dbConfig: dbConfigMap,
    env: migrationContext.config.env ?? {},
    configDir: path.dirname(migrationContext.config.path),
    appName: migrationContext.application.name,
    appId: migrationContext.application.id,
  };
}

async function validateTailorDBMigrationState(
  client: OperatorClient,
  result: TailorDBPlanResult,
): Promise<ValidateAndDetectResult> {
  const { context } = result;
  if (context.migrationTestBaselines) {
    const currentMigrationFileState = captureMigrationFileState(
      getNamespacesWithMigrations(context.config, path.dirname(context.config.path)),
    );
    if (!migrationFileStatesEqual(context.migrationFileState, currentMigrationFileState)) {
      throw new Error(
        "Migration files changed after deployment planning. Run the migration test again to create a fresh plan.",
      );
    }
    return {
      pendingMigrations: [],
      checkpointRepairs: [],
      namespacesWithMigrations: [],
      migrationFileState: currentMigrationFileState,
      migrationHistoryIds: {},
    };
  }
  const typesByNamespace = new Map<string, Record<string, TailorDBSnapshotType>>();
  for (const tailordb of context.tailorDBInputs) {
    typesByNamespace.set(tailordb.namespace, tailordb.types);
  }

  const validation = await validateAndDetectMigrations(
    client,
    context.workspaceId,
    typesByNamespace,
    context.config,
    context.noSchemaCheck,
    context.tailorDBInputs,
  );
  const approvedRepairs = context.checkpointRepairs;
  const repairPlanChanged =
    approvedRepairs.length !== validation.checkpointRepairs.length ||
    validation.checkpointRepairs.some(
      (repair) =>
        !approvedRepairs.some(
          (approved) =>
            approved.namespace === repair.namespace &&
            approved.from === repair.from &&
            approved.fromHistoryId === repair.fromHistoryId &&
            approved.toHistoryId === repair.toHistoryId,
        ),
    );
  if (repairPlanChanged) {
    throw new Error(
      "Remote migration checkpoint repair changed after deployment planning. Run the deployment again to review the updated repair.",
    );
  }
  if (!migrationFileStatesEqual(context.migrationFileState, validation.migrationFileState)) {
    throw new Error(
      "Migration files changed after deployment planning. Run the deployment again to create a fresh plan.",
    );
  }
  return validation;
}

/**
 * Revalidate migration state before the deployment enters any mutation phase.
 * @param client - Operator client instance
 * @param result - Planned TailorDB changes
 */
export async function preflightTailorDB(
  client: OperatorClient,
  result: TailorDBPlanResult,
): Promise<void> {
  await validateTailorDBMigrationState(client, result);
}

function includeUndeletedTables(
  snapshot: SchemaSnapshot,
  previousSnapshot: SchemaSnapshot | undefined,
  migration: PendingMigration,
): SchemaSnapshot {
  const undeletedTables = [...getDeletedTableNames(migration)].flatMap((tableName) => {
    const table = previousSnapshot?.tables[tableName];
    return table ? [[tableName, table] as const] : [];
  });
  return {
    ...snapshot,
    tables: {
      ...snapshot.tables,
      ...Object.fromEntries(undeletedTables),
    },
  };
}

function describeMigrationCheckpoint(number: number | null | undefined): string {
  return number == null ? "<unset>" : formatMigrationNumber(number);
}

/**
 * Apply TailorDB-related changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned TailorDB changes
 * @param phase - Apply phase (defaults to "create-update")
 */
export async function applyTailorDB(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planTailorDB>>,
  phase: Exclude<ApplyPhase, "delete"> = "create-update",
): Promise<void> {
  const { changeSet, context: migrationContext } = result;

  if (phase === "create-update") {
    // Plan-time validation makes dry runs fail fast. Repeat the full validation
    // at the apply boundary because migration files, remote checkpoints, or the
    // remote schema may have changed while waiting for confirmation.
    const { pendingMigrations, checkpointRepairs, namespacesWithMigrations, migrationHistoryIds } =
      await validateTailorDBMigrationState(client, result);

    for (const repair of checkpointRepairs) {
      await updateMigrationLabel(
        client,
        migrationContext.workspaceId,
        repair.namespace,
        repair.to,
        repair.toHistoryId,
      );
      logger.info(
        `Migration checkpoint for namespace ${repair.namespace} reset: ${formatMigrationNumber(repair.from)} → 0000.`,
      );
    }

    if (pendingMigrations.length > 0) {
      // Migration flow: Execute each migration sequentially (pre -> script -> post)
      // This ensures intermediate states are properly handled when scripts depend on them

      // Reset tracking state for this migration run
      processedTables.reset();
      deletedResources.reset();
      migrationSnapshotCache.reset();

      const migratingNamespaces = new Set(pendingMigrations.map((m) => m.namespace));
      const restrictionState = await captureMigrationRestrictionState(
        client,
        migrationContext.workspaceId,
        migratingNamespaces,
      );

      // Step 1: Create/update services once at the beginning (services don't need per-migration handling)
      await executeServicesCreation(client, changeSet);

      // Step 1.5: The migration loop below only touches the types named by
      // some pending migration's diff; changes planned for every other
      // namespace must go through the normal flow or they would be silently
      // dropped. A migrating namespace's planned creates that already exist
      // in the schema state before its first pending migration — the whole
      // baseline on a fresh-workspace replay, and every table when the
      // pending migration is data-only — are equally dropped by the loop and
      // run here too, built from that snapshot so scripts see the checkpoint
      // state rather than the final schema. Updates of types no pending diff
      // names stay skipped: applying the final schema outside the
      // per-migration phases could enforce a change whose migration has not
      // run. Snapshot-backed creates run before the loop so scripts see the
      // checkpoint world. Under --no-schema-check, planned tables absent from
      // every snapshot are deferred until migrations settle. Deletes are
      // irreversible and stay last (Step 5).
      const isOutsideMigrations = (namespaceName: string | undefined) =>
        namespaceName !== undefined && !migratingNamespaces.has(namespaceName);
      const firstPendingByNamespace = new Map<string, PendingMigration>();
      const pendingDeletedTables = new Map<string, Set<string>>();
      const pendingSnapshotTableKeys = new Set<string>();
      for (const migration of pendingMigrations) {
        const first = firstPendingByNamespace.get(migration.namespace);
        if (!first || migration.number < first.number) {
          firstPendingByNamespace.set(migration.namespace, migration);
        }
        const deleted = pendingDeletedTables.get(migration.namespace) ?? new Set<string>();
        for (const tableName of getDeletedTableNames(migration)) deleted.add(tableName);
        pendingDeletedTables.set(migration.namespace, deleted);
        for (const tableName of Object.keys(migrationSnapshotCache.load(migration).tables)) {
          pendingSnapshotTableKeys.add(`${migration.namespace}/${tableName}`);
        }
      }
      const preMigrationSnapshots = new Map<string, SchemaSnapshot>();
      for (const [namespace, first] of firstPendingByNamespace) {
        const snapshot = reconstructSnapshotFromMigrations(first.migrationsDir, first.number - 1);
        if (!snapshot) {
          throw new Error(
            `Cannot reconstruct the schema state before migration ${formatMigrationNumber(first.number)} for namespace "${namespace}"`,
          );
        }
        preMigrationSnapshots.set(namespace, snapshot);
      }

      const deferredTypeKeys = new Set<string>();
      const deferredGqlPermissionKeys = new Set(
        [...changeSet.gqlPermission.creates, ...changeSet.gqlPermission.updates]
          .filter((permission) => {
            const namespaceName = permission.request.namespaceName;
            return (
              migrationContext.noSchemaCheck &&
              namespaceName !== undefined &&
              migratingNamespaces.has(namespaceName) &&
              !pendingSnapshotTableKeys.has(`${namespaceName}/${permission.name}`)
            );
          })
          .map((permission) => `${permission.request.namespaceName}/${permission.name}`),
      );

      try {
        for (const create of changeSet.type.creates) {
          const namespaceName = create.request.namespaceName;
          if (isOutsideMigrations(namespaceName)) {
            await client.createTailorDBType(create.request);
            continue;
          }
          const tableName = create.request.tailordbType?.name;
          if (!namespaceName || !tableName) continue;
          const priorTable = preMigrationSnapshots.get(namespaceName)?.tables[tableName];
          if (!priorTable) {
            if (
              migrationContext.noSchemaCheck &&
              !pendingSnapshotTableKeys.has(`${namespaceName}/${tableName}`)
            ) {
              deferredTypeKeys.add(`${namespaceName}/${tableName}`);
            }
            continue;
          }
          // A type some pending migration removes or renames away is created
          // only when its re-adding migration runs; materializing it early
          // would erase the removal boundary (the plan holds no delete entry
          // for a name its final state keeps).
          if (pendingDeletedTables.get(namespaceName)?.has(tableName)) continue;
          const input = migrationContext.tailorDBInputs.find((i) => i.namespace === namespaceName);
          // Recorded so the pre-phase GQL-permission fallback does not create
          // the type a second time.
          processedTables.created.add(tableName);
          await client.createTailorDBType({
            workspaceId: create.request.workspaceId,
            namespaceName,
            tailordbType: generateTailorDBTypeManifestFromSnapshot(priorTable, {
              suppressRecordEvents: true,
              suppressGqlOperations: true,
              namespaceGqlOperations: input?.config.gqlOperations,
            }),
          });
        }
        for (const update of changeSet.type.updates) {
          if (!isOutsideMigrations(update.request.namespaceName)) continue;
          await client.updateTailorDBType(update.request);
        }
      } catch (error) {
        handleOptionalToRequiredError(error, [
          "Run 'tailor tailordb migration generate' to create migration files.",
          "Migration scripts allow you to handle existing data before applying the schema change.",
        ]);
      }
      await Promise.all([
        ...changeSet.gqlPermission.creates
          .filter((create) => isOutsideMigrations(create.request.namespaceName))
          .map((create) => client.createTailorDBGQLPermission(create.request)),
        ...changeSet.gqlPermission.updates
          .filter((update) => isOutsideMigrations(update.request.namespaceName))
          .map((update) => client.updateTailorDBGQLPermission(update.request)),
      ]);

      const migrationsRequiringScripts = pendingMigrations.filter((m) => m.hasScript);

      // Step 2: Build migration context for script execution (if any migrations require scripts)
      const migrationCtx =
        migrationsRequiringScripts.length > 0
          ? buildMigrationContextForScripts(client, migrationContext, migrationsRequiringScripts)
          : undefined;

      // Step 3: Execute each migration sequentially: pre -> script -> post
      if (migrationsRequiringScripts.length > 0) {
        logger.info(`Executing ${migrationsRequiringScripts.length} data migration(s)...`);
        logger.newline();
      }

      const restorationSnapshots = new Map(preMigrationSnapshots);
      const restorationSettings = new Map(restrictionState);
      const restorationCheckpoints = new Map<
        string,
        { number: number | null; historyId: string | null }
      >(
        [...firstPendingByNamespace].map(([namespaceName, firstMigration]) => [
          namespaceName,
          {
            number: firstMigration.number > 0 ? firstMigration.number - 1 : null,
            historyId: migrationHistoryIds[namespaceName] ?? null,
          },
        ]),
      );
      let migrationFailure: { error: unknown } | undefined;
      try {
        // A committed checkpoint drops its migration from the next run's pending set.
        await applyMigrationRestrictions(
          client,
          preMigrationSnapshots,
          restrictionState,
          migrationContext.tailorDBInputs,
          migrationContext.executorUsedTables,
          migrationContext.workspaceId,
        );
        for (const migration of pendingMigrations) {
          const attemptedTables = new Set<string>();
          try {
            // Pre-migration phase: Create/update tables with breaking fields as optional
            await withSpan("apply.tailorDB.migration.prePhase", () =>
              executeSingleMigrationPrePhase(
                client,
                changeSet,
                migration,
                migrationContext.tailorDBInputs,
                attemptedTables,
              ),
            );

            // Script execution (only if migrate.ts exists for this migration)
            if (migration.hasScript && migrationCtx) {
              await withSpan("apply.tailorDB.migration.script", () =>
                executeMigrations(migrationCtx, [migration]),
              );
            }
          } catch (error) {
            await rollbackSingleMigrationAfterFailure(
              client,
              migration,
              migrationContext.workspaceId,
              migrationContext.tailorDBInputs,
              attemptedTables,
            );
            throw error;
          }

          try {
            await withSpan("apply.tailorDB.migration.postPhase", () =>
              executeSingleMigrationPostPhase(
                client,
                changeSet,
                migration,
                migrationContext.tailorDBInputs,
                attemptedTables,
              ),
            );
          } catch (error) {
            await rollbackSingleMigrationAfterFailure(
              client,
              migration,
              migrationContext.workspaceId,
              migrationContext.tailorDBInputs,
              attemptedTables,
            );
            throw error;
          }

          const previousRestorationSnapshot = restorationSnapshots.get(migration.namespace);
          const previousRestorationSettings = restorationSettings.get(migration.namespace);
          const postMigrationSnapshot = migrationSnapshotCache.load(migration);
          restorationSnapshots.set(migration.namespace, postMigrationSnapshot);
          const expectedHistoryId = migrationHistoryIds[migration.namespace] ?? null;

          try {
            await updateMigrationLabel(
              client,
              migrationContext.workspaceId,
              migration.namespace,
              migration.number,
              expectedHistoryId ?? undefined,
            );
          } catch (error) {
            let remoteState: Awaited<ReturnType<typeof fetchRemoteMigrationState>>;
            try {
              remoteState = await fetchRemoteMigrationState(
                client,
                resourceTrn(migrationContext.workspaceId, "tailordb", migration.namespace),
              );
            } catch (readbackError) {
              logger.warn(
                `Could not verify migration checkpoint ${migration.namespace}/${formatMigrationNumber(migration.number)} after its update failed: ` +
                  `${readbackError instanceof Error ? readbackError.message : String(readbackError)}. ` +
                  "Leaving the post-migration schema unchanged to avoid rolling back a committed checkpoint.",
              );
              throw error;
            }

            const remoteMigrationNumber = remoteState.number ?? undefined;
            const differentHistoryAtCheckpoint =
              remoteState.historyIdInvalid || remoteState.historyId !== expectedHistoryId;
            const concurrentCheckpoint = differentHistoryAtCheckpoint
              ? `${describeMigrationCheckpoint(remoteState.number)} in a different migration history`
              : remoteMigrationNumber !== undefined && remoteMigrationNumber > migration.number
                ? formatMigrationNumber(remoteMigrationNumber)
                : undefined;
            if (concurrentCheckpoint !== undefined) {
              restorationSnapshots.delete(migration.namespace);
              throw new Error(
                `Migration checkpoint ${migration.namespace}/${formatMigrationNumber(migration.number)} advanced concurrently to ${concurrentCheckpoint}. ` +
                  "Leaving the post-migration schema unchanged and aborting this deployment.",
                { cause: error },
              );
            }

            if (remoteMigrationNumber !== migration.number) {
              restorationSnapshots.set(
                migration.namespace,
                includeUndeletedTables(
                  postMigrationSnapshot,
                  previousRestorationSnapshot,
                  migration,
                ),
              );
              logger.warn(
                `Migration checkpoint ${migration.namespace}/${formatMigrationNumber(migration.number)} could not be confirmed after its update failed; remote remains at ${describeMigrationCheckpoint(remoteMigrationNumber)}. ` +
                  "Leaving the post-migration schema unchanged to avoid rolling back a concurrent deployment. Repair the checkpoint before retrying.",
              );
              throw error;
            }
          }

          restorationCheckpoints.set(migration.namespace, {
            number: migration.number,
            historyId: expectedHistoryId,
          });

          const input = migrationContext.tailorDBInputs.find(
            (entry) => entry.namespace === migration.namespace,
          );
          if (input) {
            const committedSettings = resolveMigrationSnapshotSettings(
              postMigrationSnapshot,
              input,
              migrationContext.executorUsedTables,
            );
            for (const [tableName, settings] of previousRestorationSettings ?? []) {
              if (!previousRestorationSnapshot?.tables[tableName]) {
                committedSettings.set(tableName, settings);
              }
            }
            restorationSettings.set(migration.namespace, committedSettings);
          }

          try {
            await executeSingleMigrationPostPhaseDeletions(client, changeSet, migration);
          } catch (error) {
            logger.warn(
              `Migration checkpoint ${migration.namespace}/${formatMigrationNumber(migration.number)} was committed, but post-checkpoint cleanup failed. ` +
                "The leftover resources remain locked. Remove them manually before the next deployment; remote schema verification will fail closed until then.",
            );
            throw error;
          }
        }

        if (migrationsRequiringScripts.length > 0) {
          logger.newline();
          logger.success(`All data migrations completed successfully.`);
        }
      } catch (error) {
        migrationFailure = { error };
      }

      for (const [namespaceName, expectedCheckpoint] of restorationCheckpoints) {
        try {
          const remoteState = await fetchRemoteMigrationState(
            client,
            resourceTrn(migrationContext.workspaceId, "tailordb", namespaceName),
          );
          const checkpointStillOwned =
            remoteState.number === expectedCheckpoint.number &&
            !remoteState.historyIdInvalid &&
            remoteState.historyId === expectedCheckpoint.historyId;
          if (checkpointStillOwned) continue;

          restorationSnapshots.delete(namespaceName);
          const concurrencyError = new Error(
            `Migration checkpoint ${namespaceName}/${describeMigrationCheckpoint(expectedCheckpoint.number)} advanced concurrently to ${describeMigrationCheckpoint(remoteState.number)}. ` +
              "Skipping restoration for this namespace and aborting this deployment.",
          );
          if (migrationFailure) {
            logger.warn(
              `${concurrencyError.message} The original migration error is reported below.`,
            );
          } else {
            migrationFailure = { error: concurrencyError };
          }
        } catch (checkpointReadError) {
          restorationSnapshots.delete(namespaceName);
          const ownershipError = new Error(
            `Could not verify ownership of migration checkpoint ${namespaceName}/${describeMigrationCheckpoint(expectedCheckpoint.number)} before restoring table settings: ` +
              `${checkpointReadError instanceof Error ? checkpointReadError.message : String(checkpointReadError)}. ` +
              "Skipping restoration for this namespace and aborting this deployment.",
          );
          if (migrationFailure) {
            logger.warn(
              `${ownershipError.message} The original migration error is reported below.`,
            );
          } else {
            migrationFailure = { error: ownershipError };
          }
        }
      }

      try {
        await restoreMigrationRestrictions(
          client,
          restorationSnapshots,
          restorationSettings,
          migrationContext.tailorDBInputs,
          migrationContext.executorUsedTables,
          migrationContext.workspaceId,
        );
      } catch (restorationError) {
        if (!migrationFailure) throw restorationError;
        logger.warn(
          `Could not restore every TailorDB table after the migration failed: ${
            restorationError instanceof Error ? restorationError.message : String(restorationError)
          }. The original migration error is reported below.`,
        );
      }
      if (migrationFailure) throw migrationFailure.error;

      for (const create of changeSet.type.creates) {
        const namespaceName = create.request.namespaceName;
        const tableName = create.request.tailordbType?.name;
        if (!namespaceName || !tableName) continue;
        if (!deferredTypeKeys.has(`${namespaceName}/${tableName}`)) continue;
        await client.createTailorDBType(create.request);
      }
      await Promise.all([
        ...changeSet.gqlPermission.creates
          .filter((create) =>
            deferredGqlPermissionKeys.has(`${create.request.namespaceName}/${create.name}`),
          )
          .map((create) => client.createTailorDBGQLPermission(create.request)),
        ...changeSet.gqlPermission.updates
          .filter((update) =>
            deferredGqlPermissionKeys.has(`${update.request.namespaceName}/${update.name}`),
          )
          .map((update) => client.updateTailorDBGQLPermission(update.request)),
      ]);

      // Step 4: Delete remaining GQL permissions that weren't deleted with their tables
      const remainingGqlPermissionDeletes = changeSet.gqlPermission.deletes.filter((del) => {
        const permKey = `${del.request.namespaceName}/${del.name}`;
        return !deletedResources.gqlPermissions.has(permKey);
      });
      if (remainingGqlPermissionDeletes.length > 0) {
        await Promise.all(
          remainingGqlPermissionDeletes.map((del) =>
            client.deleteTailorDBGQLPermission(del.request),
          ),
        );
      }

      // Step 5: Delete tables outside the migrating namespaces (their GQL
      // permissions were just removed above; migration postPhases never see them)
      await Promise.all(
        changeSet.type.deletes
          .filter(
            (del) =>
              isOutsideMigrations(del.request.namespaceName) &&
              !deletedResources.types.has(del.name),
          )
          .map((del) => client.deleteTailorDBType(del.request)),
      );

      // Step 6: Write table metadata, which the migration phases above do not.
      // Tables inside migrating namespaces only exist once their phases have run,
      // so this waits until every table in the change set is present. Skipping it
      // would leave a cross-config dependency record unwritten on any deploy that
      // carries a migration, and the owner's next solo deploy would turn
      // publishing off without asking.
      await Promise.all(
        [...changeSet.type.creates, ...changeSet.type.updates, ...changeSet.type.unchanged]
          .filter((entry) => entry.metaRequest && !deletedResources.types.has(entry.name))
          .flatMap((entry) =>
            entry.metaRequest ? [writeMetadataLabels(client, entry.metaRequest)] : [],
          ),
      );
    } else {
      // Normal create-update flow without migrations
      // Services
      await Promise.all([
        ...changeSet.service.creates.map(async (create) => {
          await client.createTailorDBService(create.request);
          await writeMetadataLabels(client, create.metaRequest);
        }),
        ...changeSet.service.updates.map((update) =>
          writeMetadataLabels(client, update.metaRequest),
        ),
      ]);

      // Tables. An unchanged table still gets its labels written, because its
      // dependency records can change while its schema does not.
      try {
        for (const create of changeSet.type.creates) {
          await client.createTailorDBType(create.request);
          await writeMetadataLabels(client, create.metaRequest);
        }
        for (const update of changeSet.type.updates) {
          await client.updateTailorDBType(update.request);
          await writeMetadataLabels(client, update.metaRequest);
        }
        await Promise.all(
          changeSet.type.unchanged.flatMap((entry) =>
            entry.metaRequest ? [writeMetadataLabels(client, entry.metaRequest)] : [],
          ),
        );
      } catch (error) {
        handleOptionalToRequiredError(error, [
          "Run 'tailor tailordb migration generate' to create migration files.",
          "Migration scripts allow you to handle existing data before applying the schema change.",
        ]);
      }

      // GQLPermissions
      await Promise.all([
        ...changeSet.gqlPermission.creates.map((create) =>
          client.createTailorDBGQLPermission(create.request),
        ),
        ...changeSet.gqlPermission.updates.map((update) =>
          client.updateTailorDBGQLPermission(update.request),
        ),
      ]);

      // Delete resources (only when no migrations occurred)
      // Migrations already handle deletions in post-migration phase
      await Promise.all(
        changeSet.gqlPermission.deletes.map((del) =>
          client.deleteTailorDBGQLPermission(del.request),
        ),
      );
      await Promise.all(
        changeSet.type.deletes.map((del) => client.deleteTailorDBType(del.request)),
      );
    }

    // Skip when pending migrations ran: each already bumped the label, and
    // re-pinning to working_tree_max could mask one left intentionally pending
    // (e.g. a missing script). --no-schema-check always re-pins to repair drift.
    if (
      namespacesWithMigrations.length > 0 &&
      (migrationContext.noSchemaCheck || pendingMigrations.length === 0)
    ) {
      await reconcileMigrationLabels(
        client,
        migrationContext.workspaceId,
        namespacesWithMigrations,
        migrationHistoryIds,
      );
    }
  } else if (phase === "delete-resources") {
    // Delete GQL permissions first, then tables
    await Promise.all(
      changeSet.gqlPermission.deletes.map((del) => client.deleteTailorDBGQLPermission(del.request)),
    );
    await Promise.all(changeSet.type.deletes.map((del) => client.deleteTailorDBType(del.request)));
  } else {
    // Services only
    await Promise.all(
      changeSet.service.deletes.map((del) => client.deleteTailorDBService(del.request)),
    );
  }
}

/**
 * Execute services creation (called once at the beginning of migration flow)
 * @param {OperatorClient} client - Operator client instance
 * @param {TailorDBChangeSet} changeSet - TailorDB change set
 * @returns {Promise<void>} Promise that resolves when services are created
 */
async function executeServicesCreation(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
): Promise<void> {
  await Promise.all([
    ...changeSet.service.creates.map(async (create) => {
      await client.createTailorDBService(create.request);
      await writeMetadataLabels(client, create.metaRequest);
    }),
    ...changeSet.service.updates.map((update) => writeMetadataLabels(client, update.metaRequest)),
  ]);
}
