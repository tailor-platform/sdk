import * as path from "pathe";
import {
  getNamespacesWithMigrations,
  type NamespaceWithMigrations,
} from "#/cli/commands/tailordb/migrate/config";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
import { fetchRemoteMigrationState } from "#/cli/commands/tailordb/migrate/remote-state";
import { usesStepRunner } from "#/cli/commands/tailordb/migrate/script-form";
import {
  reconstructSnapshotFromMigrations,
  formatMigrationNumber,
  getLatestMigrationNumber,
  getMigrationFiles,
  type SchemaSnapshot,
  type TailorDBSnapshotType,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { handleOptionalToRequiredError } from "#/cli/commands/tailordb/migrate/types";
import { resolveStaticWebsiteUrlsInEnv, type OperatorClient } from "#/cli/shared/client";
import { CLIError, toError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { withSpan } from "#/cli/telemetry/index";
import { resourceTrn, writeMetadataLabels } from "../label";
import {
  clearMaintenanceModeRecord,
  clearMigrationInProgress,
  executeMigrations,
  isMigrationOutcomeUnknown,
  isMigrationPartiallyApplied,
  updateMigrationLabel,
  writeMaintenanceModeRecord,
  type MigrationContext,
} from "./migration";
import {
  applyMigrationRestrictions,
  captureMigrationRestrictionState,
  deletedResources,
  executeSingleMigrationPostPhase,
  executeSingleMigrationPostPhaseDeletions,
  executeSingleMigrationPrePhase,
  generateMigrationPhaseManifest,
  restoreMigrationRestrictions,
  getDeletedTableNames,
  migrationSnapshotCache,
  processedTables,
  resolveMigrationSnapshotSettings,
  rollbackSingleMigrationAfterFailure,
  type MigrationPhaseSettings,
  type MigrationRestrictionState,
} from "./migration-execution";
import {
  migrationFileStatesEqual,
  validateAndDetectMigrations,
  type ValidateAndDetectResult,
} from "./migration-validation";
import { removeMigrationWorkflowResources } from "./migration-workflow";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
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
 * @param maintenanceMode - Whether the migrating namespaces are in maintenance mode
 * @returns Migration context for script execution
 */
async function buildMigrationContextForScripts(
  client: OperatorClient,
  migrationContext: Awaited<ReturnType<typeof planTailorDB>>["context"],
  migrationsRequiringScripts: PendingMigration[],
  maintenanceMode: boolean,
): Promise<MigrationContext> {
  const authService = migrationContext.application.authService;
  if (!authService) {
    throw CLIError({
      code: "AUTH_CONFIG_REQUIRED",
      message: "Auth configuration is required to execute migration scripts.",
    });
  }

  const dbConfigMap: Record<string, TailorDBServiceConfig | undefined> = {};
  for (const migration of migrationsRequiringScripts) {
    if (!(migration.namespace in dbConfigMap)) {
      dbConfigMap[migration.namespace] = migrationContext.config.db?.[migration.namespace] as
        | TailorDBServiceConfig
        | undefined;
    }
  }

  // TailorDB apply always runs after staticWebsite apply in the same pass, so a
  // site this deploy just created already exists here even though `env` was
  // resolved earlier, at build time, before that site existed.
  const env = await resolveStaticWebsiteUrlsInEnv(
    client,
    migrationContext.workspaceId,
    migrationContext.application.env,
  );

  return {
    client,
    workspaceId: migrationContext.workspaceId,
    authNamespace: authService.config.name,
    machineUsers: authService.config.machineUsers
      ? Object.keys(authService.config.machineUsers)
      : undefined,
    dbConfig: dbConfigMap,
    env,
    configDir: path.dirname(migrationContext.config.path),
    appName: migrationContext.application.name,
    appId: migrationContext.application.id,
    maintenanceMode,
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
      throw CLIError({
        code: "DEPLOY_PLAN_STALE",
        message: "Migration files changed after deployment planning.",
        suggestion: "Run the migration test again to create a fresh plan.",
      });
    }
    return {
      pendingMigrations: [],
      checkpointRepairs: [],
      namespacesWithMigrations: [],
      migrationFileState: currentMigrationFileState,
      migrationHistoryIds: {},
      inProgressMigrations: {},
      staleInProgress: [],
      maintenanceModeNamespaces: [],
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
    throw CLIError({
      code: "DEPLOY_PLAN_STALE",
      message: "Remote migration checkpoint repair changed after deployment planning.",
      suggestion: "Run the deployment again to review the updated repair.",
    });
  }
  if (!migrationFileStatesEqual(context.migrationFileState, validation.migrationFileState)) {
    throw CLIError({
      code: "DEPLOY_PLAN_STALE",
      message: "Migration files changed after deployment planning.",
      suggestion: "Run the deployment again to create a fresh plan.",
    });
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

/**
 * Return a partially applied migration's tables to their Pre-phase shape after
 * its Post-phase stopped partway, so the next deploy finds the schema it resumes from.
 * @param client - Operator client instance
 * @param changeSet - TailorDB change set
 * @param migration - Migration whose Post-phase failed
 * @param phaseSettings - How this deploy's migration phases write table settings
 * @param attemptedTables - Tables the migration's phases touched
 */
async function reapplyPrePhaseAfterPostPhaseFailure(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
  phaseSettings: MigrationPhaseSettings,
  attemptedTables: Set<string>,
): Promise<void> {
  try {
    await executeSingleMigrationPrePhase(
      client,
      changeSet,
      migration,
      phaseSettings,
      attemptedTables,
    );
  } catch (error) {
    logger.warn(
      `Could not return migration ${migration.namespace}/${formatMigrationNumber(migration.number)} to its pre-migration schema: ` +
        `${error instanceof Error ? error.message : String(error)}. The original migration error is reported below.`,
    );
  }
}

async function removeRunResources(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
  migrationNumber: number,
): Promise<void> {
  try {
    await removeMigrationWorkflowResources(client, workspaceId, namespace, migrationNumber);
  } catch (error) {
    logger.warn(
      `Could not remove the temporary resources of migration ${namespace}/${formatMigrationNumber(migrationNumber)}: ` +
        `${error instanceof Error ? error.message : String(error)}. A later deploy removes them.`,
    );
  }
}

/**
 * Leave a partially applied migration's tables in their Pre-phase shape and
 * restricted, restoring only the namespace's tables the migration never touched.
 * @param namespaceName - Namespace of the partially applied migration
 * @param migration - The partially applied migration
 * @param restorationSnapshots - Snapshots to restore, updated in place
 * @param restorationSettings - Settings to restore, updated in place
 */
function keepMigrationTablesRestricted(
  namespaceName: string,
  migration: PendingMigration,
  restorationSnapshots: Map<string, SchemaSnapshot>,
  restorationSettings: MigrationRestrictionState,
): void {
  const committed = restorationSnapshots.get(namespaceName);
  if (!committed) return;
  const migrationTables = new Set([
    ...Object.keys(committed.tables),
    ...Object.keys(migrationSnapshotCache.load(migration).tables),
    ...getDeletedTableNames(migration),
  ]);
  restorationSnapshots.set(namespaceName, { ...committed, tables: {} });
  restorationSettings.set(
    namespaceName,
    new Map(
      [...(restorationSettings.get(namespaceName) ?? [])].filter(
        ([tableName]) => !migrationTables.has(tableName),
      ),
    ),
  );
}

async function clearRecordAfterRelease(
  client: OperatorClient,
  workspaceId: string,
  namespaceName: string,
): Promise<void> {
  try {
    await clearMaintenanceModeRecord(client, workspaceId, namespaceName);
  } catch (error) {
    logger.warn(
      `Namespace '${namespaceName}' left maintenance mode, but its record could not be removed: ${toError(error).message}. The next deploy that migrates it removes the record.`,
    );
  }
}

function describeMigrationCheckpoint(number: number | null | undefined): string {
  return number == null ? "<unset>" : formatMigrationNumber(number);
}

type ExpectedMigrationCheckpoint = { number: number | null; historyId: string | null };

/**
 * Find the namespaces whose migration checkpoint no longer matches the one
 * this deploy expects, so their table settings are not restored over a
 * concurrent deploy's.
 * @param client - Operator client instance
 * @param workspaceId - Target workspace ID
 * @param expectedCheckpoints - Checkpoint this deploy expects in each namespace
 * @param outcome - What the deploy does about such a namespace, appended to its error
 * @returns The error to report for each namespace whose checkpoint changed or could not be read
 */
async function findUnownedMigrationCheckpoints(
  client: OperatorClient,
  workspaceId: string,
  expectedCheckpoints: ReadonlyMap<string, ExpectedMigrationCheckpoint>,
  outcome: string,
): Promise<Map<string, CLIError>> {
  const unowned = new Map<string, CLIError>();
  for (const [namespaceName, expectedCheckpoint] of expectedCheckpoints) {
    try {
      const remoteState = await fetchRemoteMigrationState(
        client,
        resourceTrn(workspaceId, "tailordb", namespaceName),
      );
      const checkpointStillOwned =
        remoteState.number === expectedCheckpoint.number &&
        !remoteState.historyIdInvalid &&
        remoteState.historyId === expectedCheckpoint.historyId;
      if (checkpointStillOwned) continue;

      unowned.set(
        namespaceName,
        CLIError({
          code: "MIGRATION_CHECKPOINT_CONFLICT",
          message: `Migration checkpoint ${namespaceName}/${describeMigrationCheckpoint(expectedCheckpoint.number)} advanced concurrently to ${describeMigrationCheckpoint(remoteState.number)}. ${outcome}`,
        }),
      );
    } catch (checkpointReadError) {
      unowned.set(
        namespaceName,
        CLIError({
          code: "MIGRATION_CHECKPOINT_UNVERIFIED",
          message:
            `Could not verify ownership of migration checkpoint ${namespaceName}/${describeMigrationCheckpoint(expectedCheckpoint.number)} before restoring table settings: ` +
            `${checkpointReadError instanceof Error ? checkpointReadError.message : String(checkpointReadError)}. ${outcome}`,
        }),
      );
    }
  }
  return unowned;
}

/** Lifts the maintenance mode an apply held; run it once the deploy settles. */
export type MaintenanceModeRelease = (client: OperatorClient) => Promise<void>;

export type ApplyTailorDBOptions = {
  /**
   * Receives the release of a `"deploy"` maintenance mode instead of the
   * apply running it, so the caller can keep the migrated namespaces
   * restricted until the rest of the deploy is applied. The caller must run
   * it even when the apply throws afterwards.
   */
  holdMaintenanceMode?: (release: MaintenanceModeRelease) => void;
};

/**
 * Apply TailorDB-related changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned TailorDB changes
 * @param phase - Apply phase (defaults to "create-update")
 * @param options - Apply options
 */
export async function applyTailorDB(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planTailorDB>>,
  phase: Exclude<ApplyPhase, "delete"> = "create-update",
  options: ApplyTailorDBOptions = {},
): Promise<void> {
  const { changeSet, context: migrationContext } = result;
  const maintenanceMode = migrationContext.config.maintenanceMode ?? false;
  const phaseSettings: MigrationPhaseSettings = {
    tailorDBInputs: migrationContext.tailorDBInputs,
    executorUsedTables: migrationContext.executorUsedTables,
    restricted: maintenanceMode !== false,
  };

  if (phase === "create-update") {
    // Plan-time validation makes dry runs fail fast. Repeat the full validation
    // at the apply boundary because migration files, remote checkpoints, or the
    // remote schema may have changed while waiting for confirmation.
    const {
      pendingMigrations,
      checkpointRepairs,
      namespacesWithMigrations,
      migrationHistoryIds,
      inProgressMigrations,
      staleInProgress,
      maintenanceModeNamespaces,
    } = await validateTailorDBMigrationState(client, result);

    // Resolved before any mutation below -- including the checkpoint-repair
    // labels right after this -- so a lookup failure other than "the site
    // doesn't exist yet" (a permission error, a transient platform error,
    // ...) aborts before any TailorDB migration state changes instead of
    // after.
    const migrationsRequiringScripts = pendingMigrations.filter((m) => m.hasScript);
    const migrationCtx =
      migrationsRequiringScripts.length > 0
        ? await buildMigrationContextForScripts(
            client,
            migrationContext,
            migrationsRequiringScripts,
            phaseSettings.restricted,
          )
        : undefined;

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

    for (const stale of staleInProgress) {
      await clearMigrationInProgress(client, migrationContext.workspaceId, stale.namespace);
      await removeRunResources(
        client,
        migrationContext.workspaceId,
        stale.namespace,
        stale.migrationNumber,
      );
    }

    // A migration that fails or stops must leave no record behind, or the
    // next deploy would accept its restricted tables instead of reporting drift.
    const migratingNamespaceNames = new Set(pendingMigrations.map((m) => m.namespace));
    for (const namespaceName of maintenanceModeNamespaces) {
      if (!migratingNamespaceNames.has(namespaceName)) continue;
      await clearMaintenanceModeRecord(client, migrationContext.workspaceId, namespaceName);
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
          throw CLIError({
            code: "MIGRATION_HISTORY_INVALID",
            message: `Cannot reconstruct the schema state before migration ${formatMigrationNumber(first.number)} for namespace "${namespace}"`,
          });
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
          // Recorded so the pre-phase GQL-permission fallback does not create
          // the type a second time.
          processedTables.created.add(tableName);
          await client.createTailorDBType({
            workspaceId: create.request.workspaceId,
            namespaceName,
            tailordbType: generateMigrationPhaseManifest(priorTable, namespaceName, phaseSettings),
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

      // Step 3: Execute each migration sequentially: pre -> script -> post
      if (migrationsRequiringScripts.length > 0) {
        logger.info(`Executing ${migrationsRequiringScripts.length} data migration(s)...`);
        logger.newline();
      }

      const restorationSnapshots = new Map(preMigrationSnapshots);
      const restorationSettings = new Map(restrictionState);
      const restorationCheckpoints = new Map<string, ExpectedMigrationCheckpoint>(
        [...firstPendingByNamespace].map(([namespaceName, firstMigration]) => [
          namespaceName,
          {
            number: firstMigration.number > 0 ? firstMigration.number - 1 : null,
            historyId: migrationHistoryIds[namespaceName] ?? null,
          },
        ]),
      );
      let migrationFailure: { error: unknown } | undefined;
      const partialMigrations = new Map<string, PendingMigration>();
      const reachedMigrations = new Set<PendingMigration>();
      try {
        // A committed checkpoint drops its migration from the next run's pending set.
        if (phaseSettings.restricted) {
          await applyMigrationRestrictions(
            client,
            preMigrationSnapshots,
            restrictionState,
            migrationContext.tailorDBInputs,
            migrationContext.executorUsedTables,
            migrationContext.workspaceId,
          );
        }
        for (const migration of pendingMigrations) {
          reachedMigrations.add(migration);
          const attemptedTables = new Set<string>();
          const inProgress = inProgressMigrations[migration.namespace]?.number === migration.number;
          const runsSteps = usesStepRunner(migration.scriptForm, inProgress);
          try {
            // Pre-migration phase: Create/update tables with breaking fields as optional
            await withSpan("apply.tailorDB.migration.prePhase", () =>
              executeSingleMigrationPrePhase(
                client,
                changeSet,
                migration,
                phaseSettings,
                attemptedTables,
              ),
            );

            // Script execution (only if migrate.ts exists for this migration)
            if (migration.hasScript && migrationCtx) {
              await withSpan("apply.tailorDB.migration.script", () =>
                executeMigrations(migrationCtx, [migration], inProgressMigrations),
              );
            }
          } catch (error) {
            const shouldKeepPreMigrationSchema =
              inProgress || isMigrationPartiallyApplied(error) || isMigrationOutcomeUnknown(error);
            if (shouldKeepPreMigrationSchema) {
              partialMigrations.set(migration.namespace, migration);
              throw error;
            }
            await rollbackSingleMigrationAfterFailure(
              client,
              migration,
              migrationContext.workspaceId,
              phaseSettings,
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
                phaseSettings,
                attemptedTables,
              ),
            );
          } catch (error) {
            if (inProgress || runsSteps) {
              partialMigrations.set(migration.namespace, migration);
              await reapplyPrePhaseAfterPostPhaseFailure(
                client,
                changeSet,
                migration,
                phaseSettings,
                attemptedTables,
              );
              throw error;
            }
            await rollbackSingleMigrationAfterFailure(
              client,
              migration,
              migrationContext.workspaceId,
              phaseSettings,
              attemptedTables,
            );
            throw error;
          }

          const previousRestorationSnapshot = restorationSnapshots.get(migration.namespace);
          const previousRestorationSettings = restorationSettings.get(migration.namespace);
          const postMigrationSnapshot = migrationSnapshotCache.load(migration);
          restorationSnapshots.set(migration.namespace, postMigrationSnapshot);
          const expectedHistoryId = migrationHistoryIds[migration.namespace] ?? null;
          const capturedSettingsAreEarlierRestrictions = inProgress;
          const settleRestorationSettings = () => {
            const input = migrationContext.tailorDBInputs.find(
              (entry) => entry.namespace === migration.namespace,
            );
            if (!input) return;
            const committedSettings = resolveMigrationSnapshotSettings(
              postMigrationSnapshot,
              input,
              migrationContext.executorUsedTables,
            );
            for (const [tableName, settings] of previousRestorationSettings ?? []) {
              if (previousRestorationSnapshot?.tables[tableName]) continue;
              const restrictedByEarlierDeploy =
                capturedSettingsAreEarlierRestrictions &&
                postMigrationSnapshot.tables[tableName] !== undefined;
              if (!restrictedByEarlierDeploy) committedSettings.set(tableName, settings);
            }
            restorationSettings.set(migration.namespace, committedSettings);
          };
          if (capturedSettingsAreEarlierRestrictions) settleRestorationSettings();

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
              throw CLIError({
                code: "MIGRATION_CHECKPOINT_CONFLICT",
                message:
                  `Migration checkpoint ${migration.namespace}/${formatMigrationNumber(migration.number)} advanced concurrently to ${concurrentCheckpoint}. ` +
                  "Leaving the post-migration schema unchanged and aborting this deployment.",
                cause: error,
              });
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
          if (runsSteps) {
            await removeRunResources(
              client,
              migrationContext.workspaceId,
              migration.namespace,
              migration.number,
            );
          }

          if (!capturedSettingsAreEarlierRestrictions) settleRestorationSettings();

          try {
            await executeSingleMigrationPostPhaseDeletions(client, changeSet, migration);
          } catch (error) {
            logger.warn(
              `Migration checkpoint ${migration.namespace}/${formatMigrationNumber(migration.number)} was committed, but post-checkpoint cleanup failed. ` +
                (phaseSettings.restricted
                  ? "The leftover resources remain locked. Remove them"
                  : "Remove the leftover resources") +
                " manually before the next deployment; remote schema verification will fail closed until then.",
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

      const unownedCheckpoints = await findUnownedMigrationCheckpoints(
        client,
        migrationContext.workspaceId,
        restorationCheckpoints,
        "Skipping restoration for this namespace and aborting this deployment.",
      );
      for (const [namespaceName, ownershipError] of unownedCheckpoints) {
        restorationSnapshots.delete(namespaceName);
        if (migrationFailure) {
          logger.warn(`${ownershipError.message} The original migration error is reported below.`);
        } else {
          migrationFailure = { error: ownershipError };
        }
      }

      for (const migration of pendingMigrations) {
        const resumed = inProgressMigrations[migration.namespace]?.number === migration.number;
        if (resumed && !reachedMigrations.has(migration)) {
          partialMigrations.set(migration.namespace, migration);
        }
      }
      for (const [namespaceName, migration] of partialMigrations) {
        keepMigrationTablesRestricted(
          namespaceName,
          migration,
          restorationSnapshots,
          restorationSettings,
        );
      }

      const recordedNamespaces: string[] = [];
      if (phaseSettings.restricted && !migrationFailure) {
        for (const namespaceName of restorationSnapshots.keys()) {
          const checkpoint = restorationCheckpoints.get(namespaceName)?.number;
          if (checkpoint == null) continue;
          try {
            await writeMaintenanceModeRecord(
              client,
              migrationContext.workspaceId,
              namespaceName,
              checkpoint,
            );
            recordedNamespaces.push(namespaceName);
          } catch (error) {
            logger.warn(
              `Could not record that namespace '${namespaceName}' is in maintenance mode: ${toError(error).message}.`,
            );
          }
        }
      }
      const restore = async (restoreClient: OperatorClient) => {
        await restoreMigrationRestrictions(
          restoreClient,
          restorationSnapshots,
          restorationSettings,
          migrationContext.tailorDBInputs,
          migrationContext.executorUsedTables,
          migrationContext.workspaceId,
        );
        for (const namespaceName of recordedNamespaces) {
          if (!restorationSnapshots.has(namespaceName)) continue;
          await clearRecordAfterRelease(restoreClient, migrationContext.workspaceId, namespaceName);
        }
      };
      if (maintenanceMode === "deploy" && options.holdMaintenanceMode && !migrationFailure) {
        options.holdMaintenanceMode(async (releaseClient) => {
          const unowned = await findUnownedMigrationCheckpoints(
            releaseClient,
            migrationContext.workspaceId,
            restorationCheckpoints,
            "Leaving its table settings unchanged.",
          );
          for (const namespaceName of unowned.keys()) restorationSnapshots.delete(namespaceName);
          const [ownershipError, ...otherErrors] = unowned.values();
          for (const error of otherErrors) logger.warn(error.message);
          try {
            await restore(releaseClient);
          } catch (restorationError) {
            if (!ownershipError) throw restorationError;
            logger.warn(
              `Could not restore every TailorDB table: ${toError(restorationError).message}.`,
            );
          }
          if (ownershipError) throw ownershipError;
        });
      } else {
        try {
          await restore(client);
        } catch (restorationError) {
          if (!migrationFailure) throw restorationError;
          logger.warn(
            `Could not restore every TailorDB table after the migration failed: ${
              toError(restorationError).message
            }. The original migration error is reported below.`,
          );
        }
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

    for (const namespaceName of maintenanceModeNamespaces) {
      if (migratingNamespaceNames.has(namespaceName)) continue;
      await clearRecordAfterRelease(client, migrationContext.workspaceId, namespaceName);
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
