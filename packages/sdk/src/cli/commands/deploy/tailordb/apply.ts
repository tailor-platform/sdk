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
import { getErrorDiagnostics, withErrorDiagnostics } from "#/cli/shared/error-diagnostics";
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
  isMigrationRunEnded,
  rolledBackError,
  rollbackSkippedError,
  updateMigrationLabel,
  type MigrationContext,
} from "./migration";
import {
  applyMigrationRestrictions,
  acceptsMigrationWrites,
  captureMigrationRestrictionState,
  deletedResources,
  executeSingleMigrationPostPhase,
  executeSingleMigrationPostPhaseDeletions,
  executeSingleMigrationPrePhase,
  generateMigrationPhaseManifest,
  type GqlPermissionUndo,
  restoreMigrationRestrictions,
  getDeletedTableNames,
  getPreMigrationTargetTableNames,
  gqlPermissionUndoFromSnapshots,
  migrationSnapshotCache,
  namespacedTableKey,
  processedTables,
  releaseRecordedMaintenanceMode,
  type MigrationPhaseSettings,
  readUnrestoredTables,
  ROLLBACK_LEFTOVER_RECOVERY,
  RESTRICTION_EFFECT,
  resolveMigrationSnapshotSettings,
  rollbackSingleMigrationAfterFailure,
  type RollbackLeftovers,
  warnTablesLeftRestricted,
  type MigrationRestrictionState,
  type RestrictedTables,
} from "./migration-execution";
import { assertMigrationSkipSteps, selectSkipStepsOfNamespaces } from "./migration-skip-steps";
import {
  formatMaintenanceSummary,
  MaintenanceTimeline,
  type MaintenanceReport,
} from "./migration-timing";
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
    skipSteps: migrationContext.migrationSkipSteps,
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
      maintenanceModeCheckpoints: {},
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
  await assertMigrationSkipSteps({
    client,
    workspaceId: context.workspaceId,
    requested: selectSkipStepsOfNamespaces(
      context.migrationSkipSteps,
      context.tailorDBInputs.map((input) => input.namespace),
    ),
    pendingMigrations: validation.pendingMigrations,
    inProgressByNamespace: validation.inProgressMigrations,
  });
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
 * @param gqlPermissionUndo - Records how to undo each GraphQL permission the migration wrote
 */
async function reapplyPrePhaseAfterPostPhaseFailure(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
  migration: PendingMigration,
  phaseSettings: MigrationPhaseSettings,
  attemptedTables: Set<string>,
  gqlPermissionUndo: GqlPermissionUndo,
): Promise<void> {
  try {
    await executeSingleMigrationPrePhase(
      client,
      changeSet,
      migration,
      phaseSettings,
      attemptedTables,
      gqlPermissionUndo,
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
 * Whether the migration is no longer recorded as in progress. A clear whose response was lost
 * can have taken effect, and rolling back then is still right: the record is gone.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param migration - Migration whose record was being cleared
 * @returns True only when the remote state confirms the record is absent
 */
async function isRecordCleared(
  client: OperatorClient,
  workspaceId: string,
  migration: PendingMigration,
): Promise<boolean> {
  try {
    const state = await fetchRemoteMigrationState(
      client,
      resourceTrn(workspaceId, "tailordb", migration.namespace),
    );
    return !state.inProgressInvalid && state.inProgress?.number !== migration.number;
  } catch {
    return false;
  }
}

async function clearRolledBackRecord(
  client: OperatorClient,
  workspaceId: string,
  migration: PendingMigration,
): Promise<boolean> {
  const { namespace } = migration;
  try {
    await clearMigrationInProgress(client, workspaceId, namespace);
  } catch (error) {
    if (await isRecordCleared(client, workspaceId, migration)) return true;
    logger.warn(
      `Could not clear the in-progress record of migration ${namespace}/${formatMigrationNumber(migration.number)}: ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        "Its schema is left as it is, the migration stays in progress, and its tables stay in maintenance mode; deploy again to resume it.",
    );
    return false;
  }
  return true;
}

/**
 * Leave a partially applied migration's tables in their Pre-phase shape and
 * restricted, restoring only the namespace's tables the migration never touched.
 * @param namespaceName - Namespace of the partially applied migration
 * @param migration - The partially applied migration
 * @param restorationSnapshots - Snapshots to restore, updated in place
 * @param restorationSettings - Settings to restore, updated in place
 * @param history - What was captured and rewritten while restricting
 * @returns Names of the tables left restricted
 */
function keepMigrationTablesRestricted(
  namespaceName: string,
  migration: PendingMigration,
  restorationSnapshots: Map<string, SchemaSnapshot>,
  restorationSettings: MigrationRestrictionState,
  history: RestrictionHistory,
): string[] {
  const committed = restorationSnapshots.get(namespaceName);
  const migrationTables = new Set([
    ...Object.keys(committed?.tables ?? {}),
    ...Object.keys(migrationSnapshotCache.load(migration).tables),
    ...getDeletedTableNames(migration),
  ]);
  if (!committed) return restrictedByDeploy(namespaceName, migrationTables, history);
  restorationSnapshots.set(namespaceName, { ...committed, tables: {} });
  restorationSettings.set(
    namespaceName,
    new Map(
      [...(restorationSettings.get(namespaceName) ?? [])].filter(
        ([tableName]) => !migrationTables.has(tableName),
      ),
    ),
  );
  return restrictedByDeploy(namespaceName, migrationTables, history);
}

function describeSkippedTables(tables: readonly string[]): string {
  return tables.length > 0 ? `Restricted tables: ${tables.join(", ")}. ` : "";
}

interface RestrictionHistory {
  maintenanceMode: boolean;
  /** Settings captured before any restriction was applied. */
  captured: MigrationRestrictionState;
  /** Tables that migration phases rewrote, which also disables their read. */
  touched: ReadonlySet<string>;
  /** Whether an earlier deploy left this namespace's migration in progress, so its captured settings are already restricted. */
  resumed: boolean;
}

function restrictedByDeploy(
  namespaceName: string,
  tableNames: Iterable<string>,
  history: RestrictionHistory,
): string[] {
  if (!history.maintenanceMode) return [];
  return [...new Set(tableNames)]
    .filter((tableName) => {
      const captured = history.captured.get(namespaceName)?.get(tableName);
      return (
        history.resumed ||
        !captured ||
        acceptsMigrationWrites(captured) ||
        history.touched.has(tableName)
      );
    })
    .toSorted();
}

function skippedRestorationTables(
  namespaceName: string,
  restorationSnapshots: ReadonlyMap<string, SchemaSnapshot>,
  restorationSettings: MigrationRestrictionState,
  history: RestrictionHistory,
): string[] {
  return restrictedByDeploy(
    namespaceName,
    [
      ...Object.keys(restorationSnapshots.get(namespaceName)?.tables ?? {}),
      ...(restorationSettings.get(namespaceName)?.keys() ?? []),
    ],
    history,
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
      `Namespace '${namespaceName}' left maintenance mode, but its record could not be removed: ${toError(error).message}. A later deploy removes it.`,
    );
  }
}

function describeMigrationCheckpoint(number: number | null | undefined): string {
  return number == null ? "<unset>" : formatMigrationNumber(number);
}

type ExpectedMigrationCheckpoint = { number: number | null; historyId: string | null };

function isCheckpointStillOwned(
  remoteState: Awaited<ReturnType<typeof fetchRemoteMigrationState>>,
  expectedCheckpoint: ExpectedMigrationCheckpoint,
): boolean {
  return (
    remoteState.number === expectedCheckpoint.number &&
    !remoteState.historyIdInvalid &&
    remoteState.historyId === expectedCheckpoint.historyId
  );
}

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
      if (isCheckpointStillOwned(remoteState, expectedCheckpoint)) continue;

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
export type MaintenanceModeRelease = (
  client: OperatorClient,
) => Promise<MaintenanceReport | undefined>;

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
 * @returns How long migrations kept tables in maintenance mode, when any ran
 */
export async function applyTailorDB(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planTailorDB>>,
  phase: Exclude<ApplyPhase, "delete"> = "create-update",
  options: ApplyTailorDBOptions = {},
): Promise<MaintenanceReport | undefined> {
  const { changeSet } = result;
  if (phase === "create-update") return applyCreateUpdate(client, result, options);
  if (phase === "delete-resources") {
    // Delete GQL permissions first, then tables
    await Promise.all(
      changeSet.gqlPermission.deletes.map((del) => client.deleteTailorDBGQLPermission(del.request)),
    );
    await Promise.all(changeSet.type.deletes.map((del) => client.deleteTailorDBType(del.request)));
    return undefined;
  }
  // Services only
  await Promise.all(
    changeSet.service.deletes.map((del) => client.deleteTailorDBService(del.request)),
  );
  return undefined;
}

async function applyCreateUpdate(
  client: OperatorClient,
  result: TailorDBPlanResult,
  options: ApplyTailorDBOptions,
): Promise<MaintenanceReport | undefined> {
  const { changeSet, context: migrationContext } = result;
  const maintenanceMode = migrationContext.config.maintenanceMode ?? "migration";
  const phaseSettings: MigrationPhaseSettings = {
    tailorDBInputs: migrationContext.tailorDBInputs,
    executorUsedTables: migrationContext.executorUsedTables,
    restricted: maintenanceMode !== false,
  };

  // Plan-time validation makes dry runs fail fast. Repeat the full validation
  // at the apply boundary because migration files, remote checkpoints, or the
  // remote schema may have changed while waiting for confirmation.
  const validation = await validateTailorDBMigrationState(client, result);
  const {
    pendingMigrations,
    checkpointRepairs,
    namespacesWithMigrations,
    migrationHistoryIds,
    staleInProgress,
    maintenanceModeCheckpoints,
  } = validation;

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

  const migratingNamespaceNames = new Set(pendingMigrations.map((m) => m.namespace));
  let maintenance: MaintenanceReport | undefined;
  if (pendingMigrations.length > 0) {
    maintenance = await applyWithMigrations({
      client,
      changeSet,
      migrationContext,
      phaseSettings,
      validation,
      migrationsRequiringScripts,
      migrationCtx,
      holdMaintenanceMode: maintenanceMode === "deploy" ? options.holdMaintenanceMode : undefined,
    });
  } else {
    await applyWithoutMigrations(client, changeSet);
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

  for (const namespaceName of Object.keys(maintenanceModeCheckpoints)) {
    if (migratingNamespaceNames.has(namespaceName)) continue;
    await clearRecordAfterRelease(client, migrationContext.workspaceId, namespaceName);
  }
  return maintenance;
}

const OPTIONAL_TO_REQUIRED_SUGGESTIONS = [
  "Run 'tailor tailordb migration generate' to create migration files.",
  "Migration scripts allow you to handle existing data before applying the schema change.",
];

interface MigrationApplyInput {
  client: OperatorClient;
  changeSet: TailorDBChangeSet;
  migrationContext: TailorDBPlanResult["context"];
  phaseSettings: MigrationPhaseSettings;
  validation: ValidateAndDetectResult;
  migrationsRequiringScripts: PendingMigration[];
  migrationCtx: MigrationContext | undefined;
  /** Set only when a `"deploy"` maintenance mode is held for the caller to release. */
  holdMaintenanceMode: ApplyTailorDBOptions["holdMaintenanceMode"];
}

interface PendingMigrationIndex {
  firstByNamespace: Map<string, PendingMigration>;
  lastByNamespace: Map<string, PendingMigration>;
  deletedTables: Map<string, Set<string>>;
  /** `<namespace>/<table>` of every table in some pending migration's snapshot. */
  snapshotTableKeys: Set<string>;
}

interface MigrationFlow extends Omit<MigrationApplyInput, "holdMaintenanceMode"> {
  migratingNamespaces: ReadonlySet<string>;
  pending: PendingMigrationIndex;
  /** Schema state before each namespace's first pending migration. */
  preMigrationSnapshots: Map<string, SchemaSnapshot>;
  restrictionState: MigrationRestrictionState;
  timeline: MaintenanceTimeline | undefined;
}

/** What each migrating namespace's tables return to once the migrations settle. */
interface RestorationState {
  snapshots: Map<string, SchemaSnapshot>;
  settings: MigrationRestrictionState;
  /** Checkpoint a namespace must still be at for its tables to be restored. */
  checkpoints: Map<string, ExpectedMigrationCheckpoint>;
  skipped: Set<string>;
}

interface MigrationRunLog {
  reached: Set<PendingMigration>;
  partial: Map<string, PendingMigration>;
  unrolledBack: ({ migration: PendingMigration } & RollbackLeftovers)[];
  touchedTables: { namespace: string; tables: ReadonlySet<string> }[];
  recordedNamespaces: Set<string>;
}

interface MigrationAttempt {
  migration: PendingMigration;
  attemptedTables: Set<string>;
  inProgress: boolean;
  runsSteps: boolean;
  rollsBackOnFailure: boolean;
  gqlPermissionUndo: GqlPermissionUndo;
}

type MigrationFailure = { error: unknown };

interface MigrationOutcome {
  failure: MigrationFailure | undefined;
  /** Errors to report alongside the failure. */
  restorationFailures: Record<string, Error>;
}

interface DeferredChanges {
  typeKeys: Set<string>;
  gqlPermissionKeys: Set<string>;
}

async function applyWithMigrations(
  input: MigrationApplyInput,
): Promise<MaintenanceReport | undefined> {
  const { holdMaintenanceMode, ...flowInput } = input;
  const { client, changeSet, migrationContext, phaseSettings, validation } = input;
  // Migration flow: Execute each migration sequentially (pre -> script -> post)
  // This ensures intermediate states are properly handled when scripts depend on them

  // Reset tracking state for this migration run
  processedTables.reset();
  deletedResources.reset();
  migrationSnapshotCache.reset();

  const migratingNamespaces = new Set(validation.pendingMigrations.map((m) => m.namespace));
  const restrictionState = await captureMigrationRestrictionState(
    client,
    migrationContext.workspaceId,
    migratingNamespaces,
  );

  // Create/update services once at the beginning (services don't need per-migration handling)
  await executeServicesCreation(client, changeSet);

  const pending = indexPendingMigrations(validation.pendingMigrations);
  const flow: MigrationFlow = {
    ...flowInput,
    migratingNamespaces,
    pending,
    preMigrationSnapshots: loadPreMigrationSnapshots(
      migrationContext,
      pending.firstByNamespace,
      restrictionState,
      validation.maintenanceModeCheckpoints,
    ),
    restrictionState,
    timeline: phaseSettings.restricted ? new MaintenanceTimeline() : undefined,
  };

  const deferred = await applyChangesBeforeMigrations(flow);

  if (flow.migrationsRequiringScripts.length > 0) {
    logger.info(`Executing ${flow.migrationsRequiringScripts.length} data migration(s)...`);
    logger.newline();
  }

  const restoration: RestorationState = {
    snapshots: new Map(flow.preMigrationSnapshots),
    settings: new Map(restrictionState),
    checkpoints: new Map(
      [...pending.firstByNamespace].map(([namespaceName, firstMigration]) => [
        namespaceName,
        {
          number: firstMigration.number > 0 ? firstMigration.number - 1 : null,
          historyId: validation.migrationHistoryIds[namespaceName] ?? null,
        },
      ]),
    ),
    skipped: new Set(),
  };
  const runLog: MigrationRunLog = {
    reached: new Set(),
    partial: new Map(),
    unrolledBack: [],
    touchedTables: [],
    recordedNamespaces: new Set(),
  };
  const runFailure = await runPendingMigrations(flow, restoration, runLog);

  flow.timeline?.enter("restore");
  const { failure, restorationFailures } = await verifyRestorationCheckpoints(
    flow,
    restoration,
    runLog,
    runFailure,
  );
  keepPartialMigrationsRestricted(flow, restoration, runLog);

  const held = failure ? undefined : holdMaintenanceMode;
  let unrestored: readonly RestrictedTables[] = [];
  if (held) {
    flow.timeline?.enter("remainingDeploy");
    held((releaseClient) => releaseHeldMaintenanceMode(flow, restoration, runLog, releaseClient));
  } else {
    unrestored = await restoreAfterMigrations(flow, restoration, runLog, {
      failure,
      restorationFailures,
    });
  }
  warnIncompleteRollbacks(flow, restoration, runLog, unrestored);
  if (failure) {
    flow.timeline?.finish();
    const { error } = failure;
    if (error instanceof Error && Object.keys(restorationFailures).length > 0) {
      throw withErrorDiagnostics(error, {
        causes: { ...getErrorDiagnostics(error).causes, ...restorationFailures },
      });
    }
    throw error;
  }
  const maintenance = held ? undefined : finishMaintenance(flow);

  await applyDeferredChanges(flow, deferred);
  await applyRemainingDeletions(flow);

  // Write table metadata, which the migration phases above do not.
  // Tables inside migrating namespaces only exist once their phases have run,
  // so this waits until every table in the change set is present. Skipping it
  // would leave a cross-config dependency record unwritten on any deploy that
  // carries a migration, and the owner's next solo deploy would turn
  // publishing off without asking.
  await Promise.all(
    [...changeSet.type.creates, ...changeSet.type.updates, ...changeSet.type.unchanged].flatMap(
      (entry) => (entry.metaRequest ? [writeMetadataLabels(client, entry.metaRequest)] : []),
    ),
  );
  return maintenance;
}

function indexPendingMigrations(pendingMigrations: PendingMigration[]): PendingMigrationIndex {
  const index: PendingMigrationIndex = {
    firstByNamespace: new Map(),
    lastByNamespace: new Map(),
    deletedTables: new Map(),
    snapshotTableKeys: new Set(),
  };
  for (const migration of pendingMigrations) {
    const first = index.firstByNamespace.get(migration.namespace);
    if (!first || migration.number < first.number) {
      index.firstByNamespace.set(migration.namespace, migration);
    }
    const last = index.lastByNamespace.get(migration.namespace);
    if (!last || migration.number > last.number) {
      index.lastByNamespace.set(migration.namespace, migration);
    }
    const deleted = index.deletedTables.get(migration.namespace) ?? new Set<string>();
    for (const tableName of getDeletedTableNames(migration)) deleted.add(tableName);
    index.deletedTables.set(migration.namespace, deleted);
    for (const tableName of Object.keys(migrationSnapshotCache.load(migration).tables)) {
      index.snapshotTableKeys.add(`${migration.namespace}/${tableName}`);
    }
  }
  return index;
}

/**
 * Reconstruct the schema state before each namespace's first pending migration, and
 * release the maintenance mode an earlier deploy recorded at that checkpoint from the
 * captured settings.
 * @param migrationContext - Planned TailorDB context
 * @param firstByNamespace - First pending migration of each namespace
 * @param restrictionState - Captured table settings, updated in place
 * @param maintenanceModeCheckpoints - Checkpoint of each namespace's recorded maintenance mode
 * @returns Schema state before each namespace's first pending migration
 */
function loadPreMigrationSnapshots(
  migrationContext: TailorDBPlanResult["context"],
  firstByNamespace: ReadonlyMap<string, PendingMigration>,
  restrictionState: MigrationRestrictionState,
  maintenanceModeCheckpoints: Readonly<Record<string, number>>,
): Map<string, SchemaSnapshot> {
  const preMigrationSnapshots = new Map<string, SchemaSnapshot>();
  for (const [namespace, first] of firstByNamespace) {
    const snapshot = reconstructSnapshotFromMigrations(first.migrationsDir, first.number - 1);
    if (!snapshot) {
      throw CLIError({
        code: "MIGRATION_HISTORY_INVALID",
        message: `Cannot reconstruct the schema state before migration ${formatMigrationNumber(first.number)} for namespace "${namespace}"`,
      });
    }
    preMigrationSnapshots.set(namespace, snapshot);
    const input = migrationContext.tailorDBInputs.find((entry) => entry.namespace === namespace);
    const capturedSettings = restrictionState.get(namespace);
    if (maintenanceModeCheckpoints[namespace] === first.number - 1 && input && capturedSettings) {
      restrictionState.set(
        namespace,
        releaseRecordedMaintenanceMode(
          capturedSettings,
          snapshot,
          input,
          migrationContext.executorUsedTables,
        ),
      );
    }
  }
  return preMigrationSnapshots;
}

function isOutsideMigrations(flow: MigrationFlow, namespaceName: string | undefined): boolean {
  return namespaceName !== undefined && !flow.migratingNamespaces.has(namespaceName);
}

/**
 * Apply the planned changes the migration loop would otherwise drop. The loop only
 * touches the types named by some pending migration's diff; changes planned for every
 * other namespace must go through the normal flow or they would be silently dropped.
 * A migrating namespace's planned creates that already exist in the schema state before
 * its first pending migration — the whole baseline on a fresh-workspace replay, and
 * every table when the pending migration is data-only — are equally dropped by the loop
 * and run here too, built from that snapshot so scripts see the checkpoint state rather
 * than the final schema. Updates of types no pending diff names stay skipped: applying
 * the final schema outside the per-migration phases could enforce a change whose
 * migration has not run. Under --no-schema-check, planned tables absent from every
 * snapshot are deferred until migrations settle. Deletes are irreversible and stay last.
 * @param flow - Migration flow
 * @returns Changes to apply once migrations settle
 */
async function applyChangesBeforeMigrations(flow: MigrationFlow): Promise<DeferredChanges> {
  const { client, changeSet, migrationContext, phaseSettings, pending } = flow;
  const deferred: DeferredChanges = {
    typeKeys: new Set(),
    gqlPermissionKeys: new Set(
      [...changeSet.gqlPermission.creates, ...changeSet.gqlPermission.updates]
        .filter((permission) => {
          const namespaceName = permission.request.namespaceName;
          return (
            migrationContext.noSchemaCheck &&
            namespaceName !== undefined &&
            flow.migratingNamespaces.has(namespaceName) &&
            !pending.snapshotTableKeys.has(`${namespaceName}/${permission.name}`)
          );
        })
        .map((permission) => `${permission.request.namespaceName}/${permission.name}`),
    ),
  };

  try {
    for (const create of changeSet.type.creates) {
      const namespaceName = create.request.namespaceName;
      if (isOutsideMigrations(flow, namespaceName)) {
        await client.createTailorDBType(create.request);
        continue;
      }
      const tableName = create.request.tailordbType?.name;
      if (!namespaceName || !tableName) continue;
      const priorTable = flow.preMigrationSnapshots.get(namespaceName)?.tables[tableName];
      if (!priorTable) {
        if (
          migrationContext.noSchemaCheck &&
          !pending.snapshotTableKeys.has(`${namespaceName}/${tableName}`)
        ) {
          deferred.typeKeys.add(`${namespaceName}/${tableName}`);
        }
        continue;
      }
      // A type some pending migration removes or renames away is created
      // only when its re-adding migration runs; materializing it early
      // would erase the removal boundary (the plan holds no delete entry
      // for a name its final state keeps).
      if (pending.deletedTables.get(namespaceName)?.has(tableName)) continue;
      // Recorded so the pre-phase GQL-permission fallback does not create
      // the type a second time.
      processedTables.created.add(namespacedTableKey(namespaceName, tableName));
      await client.createTailorDBType({
        workspaceId: create.request.workspaceId,
        namespaceName,
        tailordbType: generateMigrationPhaseManifest(priorTable, namespaceName, phaseSettings),
      });
    }
    for (const update of changeSet.type.updates) {
      if (!isOutsideMigrations(flow, update.request.namespaceName)) continue;
      await client.updateTailorDBType(update.request);
    }
  } catch (error) {
    handleOptionalToRequiredError(error, OPTIONAL_TO_REQUIRED_SUGGESTIONS);
  }
  await Promise.all([
    ...changeSet.gqlPermission.creates
      .filter((create) => isOutsideMigrations(flow, create.request.namespaceName))
      .map((create) => client.createTailorDBGQLPermission(create.request)),
    ...changeSet.gqlPermission.updates
      .filter((update) => isOutsideMigrations(flow, update.request.namespaceName))
      .map((update) => client.updateTailorDBGQLPermission(update.request)),
  ]);
  return deferred;
}

async function runPendingMigrations(
  flow: MigrationFlow,
  restoration: RestorationState,
  runLog: MigrationRunLog,
): Promise<MigrationFailure | undefined> {
  const { client, migrationContext } = flow;
  try {
    flow.timeline?.enter("restrict");
    // A committed checkpoint drops its migration from the next run's pending set.
    if (flow.phaseSettings.restricted) {
      await applyMigrationRestrictions(
        client,
        flow.preMigrationSnapshots,
        flow.restrictionState,
        migrationContext.tailorDBInputs,
        migrationContext.executorUsedTables,
        migrationContext.workspaceId,
      );
    }
    for (const migration of flow.validation.pendingMigrations) {
      await runMigration(flow, migration, restoration, runLog);
    }

    if (flow.migrationsRequiringScripts.length > 0) {
      logger.newline();
      logger.success(`All data migrations completed successfully.`);
    }
    return undefined;
  } catch (error) {
    return { error };
  }
}

async function runMigration(
  flow: MigrationFlow,
  migration: PendingMigration,
  restoration: RestorationState,
  runLog: MigrationRunLog,
): Promise<void> {
  runLog.reached.add(migration);
  const attemptedTables = new Set<string>();
  runLog.touchedTables.push({ namespace: migration.namespace, tables: attemptedTables });
  const inProgress =
    flow.validation.inProgressMigrations[migration.namespace]?.number === migration.number;
  const runsSteps = usesStepRunner(migration.scriptForm, inProgress);
  const attempt: MigrationAttempt = {
    migration,
    attemptedTables,
    inProgress,
    runsSteps,
    rollsBackOnFailure:
      runsSteps &&
      migration.scriptForm?.kind === "steps" &&
      migration.scriptForm.rollbackOnFailure === true,
    gqlPermissionUndo: new Map(),
  };
  await runPreMigrationPhase(flow, attempt, restoration, runLog);
  await runPostMigrationPhase(flow, attempt, restoration, runLog);
  await commitMigration(flow, attempt, restoration, runLog);
}

async function runPreMigrationPhase(
  flow: MigrationFlow,
  attempt: MigrationAttempt,
  restoration: RestorationState,
  runLog: MigrationRunLog,
): Promise<void> {
  const { client, changeSet, phaseSettings, migrationCtx } = flow;
  const { migration, attemptedTables, inProgress, rollsBackOnFailure, gqlPermissionUndo } = attempt;
  flow.timeline?.enter("preMigration");
  try {
    // Pre-migration phase: Create/update tables with breaking fields as optional
    await withSpan("apply.tailorDB.migration.prePhase", () =>
      executeSingleMigrationPrePhase(
        client,
        changeSet,
        migration,
        phaseSettings,
        attemptedTables,
        gqlPermissionUndo,
      ),
    );

    // Script execution (only if migrate.ts exists for this migration)
    if (migration.hasScript && migrationCtx) {
      await withSpan("apply.tailorDB.migration.script", () =>
        executeMigrations(
          migrationCtx,
          [migration],
          flow.validation.inProgressMigrations,
          flow.timeline,
        ),
      );
    }
  } catch (error) {
    const shouldKeepPreMigrationSchema =
      isMigrationOutcomeUnknown(error) ||
      (rollsBackOnFailure
        ? !isRollbackSafe(error, inProgress)
        : inProgress || isMigrationPartiallyApplied(error));
    if (shouldKeepPreMigrationSchema) {
      runLog.partial.set(migration.namespace, migration);
      throw error;
    }
    const recordMayExist = inProgress || isMigrationPartiallyApplied(error);
    throw await rollbackMigration(flow, attempt, restoration, runLog, error, recordMayExist);
  }
}

/**
 * Whether a failure of a migration that asked to be rolled back leaves no step writing. A resumed
 * migration's earlier workflow execution is only known to have ended when the runner observed it,
 * so a failure that happened before the runner (a Pre-phase or bundling error) does not count.
 * @param error - The failure of the Pre-phase or the script
 * @param inProgress - Whether an earlier deploy left the migration in progress
 * @returns True when rolling back cannot race a running step
 */
function isRollbackSafe(error: unknown, inProgress: boolean): boolean {
  if (isMigrationRunEnded(error)) return true;
  return !inProgress && !isMigrationPartiallyApplied(error);
}

async function runPostMigrationPhase(
  flow: MigrationFlow,
  attempt: MigrationAttempt,
  restoration: RestorationState,
  runLog: MigrationRunLog,
): Promise<void> {
  const { client, changeSet, phaseSettings } = flow;
  const {
    migration,
    attemptedTables,
    inProgress,
    runsSteps,
    rollsBackOnFailure,
    gqlPermissionUndo,
  } = attempt;
  flow.timeline?.enter("postMigration");
  try {
    await withSpan("apply.tailorDB.migration.postPhase", () =>
      executeSingleMigrationPostPhase(client, changeSet, migration, phaseSettings, attemptedTables),
    );
  } catch (error) {
    if (!rollsBackOnFailure && (inProgress || runsSteps)) {
      runLog.partial.set(migration.namespace, migration);
      await reapplyPrePhaseAfterPostPhaseFailure(
        client,
        changeSet,
        migration,
        phaseSettings,
        attemptedTables,
        gqlPermissionUndo,
      );
      throw error;
    }
    throw await rollbackMigration(flow, attempt, restoration, runLog, error, true);
  }
}

/**
 * Roll a failed migration's schema back. A migration that asked to be rolled back
 * clears its in-progress record first, because a record that survives a rollback
 * makes the next deploy resume against a schema its completed steps no longer match.
 * @param flow - Migration flow
 * @param attempt - Attempt that failed
 * @param restoration - What the tables return to, updated in place
 * @param runLog - Receives what the rollback could not revert
 * @param error - The failure that triggered the rollback
 * @param recordMayExist - Whether the migration may still be recorded as in progress; a failure that
 * settled the record itself, such as a Pre-phase schema error, leaves nothing to clear
 * @returns The error to raise in place of the failure
 */
async function rollbackMigration(
  flow: MigrationFlow,
  attempt: MigrationAttempt,
  restoration: RestorationState,
  runLog: MigrationRunLog,
  error: unknown,
  recordMayExist: boolean,
): Promise<unknown> {
  const { client, migrationContext, phaseSettings } = flow;
  const { migration, rollsBackOnFailure, inProgress, gqlPermissionUndo } = attempt;
  const { workspaceId } = migrationContext;
  if (
    rollsBackOnFailure &&
    recordMayExist &&
    !(await clearRolledBackRecord(client, workspaceId, migration))
  ) {
    runLog.partial.set(migration.namespace, migration);
    return rollbackSkippedError(migration, error, phaseSettings.restricted);
  }
  const attemptedTables = new Set(attempt.attemptedTables);
  const resumedRollback = rollsBackOnFailure && inProgress;
  const finalMigration = flow.pending.lastByNamespace.get(migration.namespace) ?? migration;
  for (const tableName of readRollbackScope(
    migration,
    finalMigration,
    gqlPermissionUndo,
    resumedRollback,
  )) {
    attemptedTables.add(tableName);
  }
  runLog.unrolledBack.push({
    migration,
    ...(await rollbackSingleMigrationAfterFailure(
      client,
      migration,
      workspaceId,
      phaseSettings,
      attemptedTables,
      gqlPermissionUndo,
    )),
  });
  if (!rollsBackOnFailure) return error;
  await removeRunResources(client, workspaceId, migration.namespace, migration.number);
  if (inProgress) settleRolledBackRestorationSettings(flow, migration, restoration);
  return rolledBackError(migration, error);
}

/**
 * Read what the rollback has to undo beyond what this attempt recorded: the GraphQL permission each
 * table had at the prior checkpoint, and for a resumed migration also the tables an earlier deploy's
 * Pre-phase wrote. A resumed migration's snapshot-derived permissions replace this deploy's undo
 * records, because a forced update after an SDK upgrade records the permission the earlier Pre-phase
 * installed as the one to restore. A failure to read the prior checkpoint is logged, so the rollback
 * of this deploy's own writes and the original error go ahead.
 * @param migration - The migration being rolled back
 * @param finalMigration - The last pending migration of the namespace
 * @param gqlPermissionUndo - Undo records of this attempt, updated in place
 * @param resumed - Whether an earlier deploy left the migration in progress
 * @returns The tables to roll back besides those this deploy wrote
 */
function readRollbackScope(
  migration: PendingMigration,
  finalMigration: PendingMigration,
  gqlPermissionUndo: GqlPermissionUndo,
  resumed: boolean,
): ReadonlySet<string> {
  try {
    const tables = resumed ? getPreMigrationTargetTableNames(migration) : new Set<string>();
    for (const [tableName, undo] of gqlPermissionUndoFromSnapshots(migration, finalMigration)) {
      if (resumed || !gqlPermissionUndo.has(tableName)) gqlPermissionUndo.set(tableName, undo);
    }
    return tables;
  } catch (error) {
    logger.warn(
      `Could not read migration ${migration.namespace}/${formatMigrationNumber(migration.number)} or its prior checkpoint: ` +
        `${error instanceof Error ? error.message : String(error)}. Only what this deploy wrote is rolled back.`,
    );
    return new Set();
  }
}

/**
 * Point the settings a rolled-back migration's tables are restored to at the schema they
 * returned to. The settings captured at the start of a deploy that resumes a migration are
 * the restrictions an earlier deploy applied, which would stay in place after the rollback.
 * @param flow - Migration flow
 * @param migration - The migration that was rolled back
 * @param restoration - What the tables return to, updated in place
 */
function settleRolledBackRestorationSettings(
  flow: MigrationFlow,
  migration: PendingMigration,
  restoration: RestorationState,
): void {
  const input = flow.migrationContext.tailorDBInputs.find(
    (entry) => entry.namespace === migration.namespace,
  );
  const committedSnapshot = restoration.snapshots.get(migration.namespace);
  if (!input || !committedSnapshot) return;
  const settings = resolveMigrationSnapshotSettings(
    committedSnapshot,
    input,
    flow.migrationContext.executorUsedTables,
  );
  const migrationTables = migrationSnapshotCache.load(migration).tables;
  for (const [tableName, captured] of restoration.settings.get(migration.namespace) ?? []) {
    if (!committedSnapshot.tables[tableName] && !migrationTables[tableName]) {
      settings.set(tableName, captured);
    }
  }
  restoration.settings.set(migration.namespace, settings);
}

async function commitMigration(
  flow: MigrationFlow,
  attempt: MigrationAttempt,
  restoration: RestorationState,
  runLog: MigrationRunLog,
): Promise<void> {
  const { client, changeSet, migrationContext, phaseSettings } = flow;
  const { migration, inProgress, runsSteps } = attempt;
  const previousRestorationSnapshot = restoration.snapshots.get(migration.namespace);
  const previousRestorationSettings = restoration.settings.get(migration.namespace);
  const postMigrationSnapshot = migrationSnapshotCache.load(migration);
  restoration.snapshots.set(migration.namespace, postMigrationSnapshot);
  const expectedHistoryId = flow.validation.migrationHistoryIds[migration.namespace] ?? null;
  const recordsMaintenanceMode =
    phaseSettings.restricted && flow.pending.lastByNamespace.get(migration.namespace) === migration;
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
    restoration.settings.set(migration.namespace, committedSettings);
  };
  if (capturedSettingsAreEarlierRestrictions) settleRestorationSettings();

  try {
    await updateMigrationLabel(
      client,
      migrationContext.workspaceId,
      migration.namespace,
      migration.number,
      expectedHistoryId ?? undefined,
      recordsMaintenanceMode,
    );
  } catch (error) {
    await confirmCheckpointAfterUpdateFailure(
      flow,
      attempt,
      error,
      restoration,
      previousRestorationSnapshot,
      postMigrationSnapshot,
    );
  }

  restoration.checkpoints.set(migration.namespace, {
    number: migration.number,
    historyId: expectedHistoryId,
  });
  if (recordsMaintenanceMode) runLog.recordedNamespaces.add(migration.namespace);
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

/**
 * Read a migration's checkpoint back after its update failed, and return only when the
 * remote checkpoint shows the update was committed.
 * @param flow - Migration flow
 * @param attempt - Attempt whose checkpoint update failed
 * @param updateError - Error the checkpoint update failed with
 * @param restoration - What the tables return to, updated in place
 * @param previousRestorationSnapshot - Snapshot to restore before the migration ran
 * @param postMigrationSnapshot - Schema state the migration produced
 */
async function confirmCheckpointAfterUpdateFailure(
  flow: MigrationFlow,
  attempt: MigrationAttempt,
  updateError: unknown,
  restoration: RestorationState,
  previousRestorationSnapshot: SchemaSnapshot | undefined,
  postMigrationSnapshot: SchemaSnapshot,
): Promise<void> {
  const { migration } = attempt;
  const expectedHistoryId = flow.validation.migrationHistoryIds[migration.namespace] ?? null;
  let remoteState: Awaited<ReturnType<typeof fetchRemoteMigrationState>>;
  try {
    remoteState = await fetchRemoteMigrationState(
      flow.client,
      resourceTrn(flow.migrationContext.workspaceId, "tailordb", migration.namespace),
    );
  } catch (readbackError) {
    logger.warn(
      `Could not verify migration checkpoint ${migration.namespace}/${formatMigrationNumber(migration.number)} after its update failed: ` +
        `${readbackError instanceof Error ? readbackError.message : String(readbackError)}. ` +
        "Leaving the post-migration schema unchanged to avoid rolling back a committed checkpoint.",
    );
    throw updateError;
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
    restoration.snapshots.delete(migration.namespace);
    throw CLIError({
      code: "MIGRATION_CHECKPOINT_CONFLICT",
      message:
        `Migration checkpoint ${migration.namespace}/${formatMigrationNumber(migration.number)} advanced concurrently to ${concurrentCheckpoint}. ` +
        "Leaving the post-migration schema unchanged and aborting this deployment.",
      cause: updateError,
    });
  }

  if (remoteMigrationNumber !== migration.number) {
    restoration.snapshots.set(
      migration.namespace,
      includeUndeletedTables(postMigrationSnapshot, previousRestorationSnapshot, migration),
    );
    logger.warn(
      `Migration checkpoint ${migration.namespace}/${formatMigrationNumber(migration.number)} could not be confirmed after its update failed; remote remains at ${describeMigrationCheckpoint(remoteMigrationNumber)}. ` +
        "Leaving the post-migration schema unchanged to avoid rolling back a concurrent deployment. Repair the checkpoint before retrying.",
    );
    throw updateError;
  }
}

function restrictionHistoryOf(
  flow: MigrationFlow,
  runLog: MigrationRunLog,
  namespace: string,
): RestrictionHistory {
  return {
    maintenanceMode: flow.phaseSettings.restricted,
    captured: flow.restrictionState,
    resumed: flow.validation.inProgressMigrations[namespace] !== undefined,
    touched: new Set(
      runLog.touchedTables.flatMap((entry) =>
        entry.namespace === namespace ? [...entry.tables] : [],
      ),
    ),
  };
}

/**
 * Skip restoring each namespace whose checkpoint is no longer the one this deploy
 * expects, or could not be read.
 * @param flow - Migration flow
 * @param restoration - What the tables return to, updated in place
 * @param runLog - What happened while the migrations ran
 * @param runFailure - How the migrations failed, if they did
 * @returns The deploy's failure, and the skipped restorations to report alongside it
 */
async function verifyRestorationCheckpoints(
  flow: MigrationFlow,
  restoration: RestorationState,
  runLog: MigrationRunLog,
  runFailure: MigrationFailure | undefined,
): Promise<MigrationOutcome> {
  let failure = runFailure;
  const restorationFailures: Record<string, Error> = {};
  for (const [namespaceName, expectedCheckpoint] of restoration.checkpoints) {
    const error = await checkRestorationCheckpoint(
      flow,
      restoration,
      runLog,
      namespaceName,
      expectedCheckpoint,
    );
    if (!error) continue;
    if (failure) {
      logger.warn(`${error.message} The original migration error is reported below.`);
      if (error.suggestion) logger.log(error.suggestion);
      restorationFailures[`restorationSkipped:${namespaceName}`] = error;
    } else {
      failure = { error };
    }
  }
  return { failure, restorationFailures };
}

async function checkRestorationCheckpoint(
  flow: MigrationFlow,
  restoration: RestorationState,
  runLog: MigrationRunLog,
  namespaceName: string,
  expectedCheckpoint: ExpectedMigrationCheckpoint,
): Promise<CLIError | undefined> {
  const { restricted } = flow.phaseSettings;
  let remoteState: Awaited<ReturnType<typeof fetchRemoteMigrationState>>;
  try {
    remoteState = await fetchRemoteMigrationState(
      flow.client,
      resourceTrn(flow.migrationContext.workspaceId, "tailordb", namespaceName),
    );
  } catch (checkpointReadError) {
    const tables = skipRestoration(flow, restoration, runLog, namespaceName);
    return CLIError({
      code: "MIGRATION_CHECKPOINT_UNVERIFIED",
      message:
        `Could not verify ownership of migration checkpoint ${namespaceName}/${describeMigrationCheckpoint(expectedCheckpoint.number)} before restoring table settings: ` +
        `${checkpointReadError instanceof Error ? checkpointReadError.message : String(checkpointReadError)}. ` +
        "Skipping restoration for this namespace and aborting this deployment.",
      suggestion:
        (restricted
          ? `The tables of namespace '${namespaceName}' keep the restrictions this deploy set (${RESTRICTION_EFFECT}). `
          : `The table settings of namespace '${namespaceName}' are left unchanged. `) +
        `${describeSkippedTables(tables)}Run \`tailor tailordb migration status --namespace ${namespaceName}\` to check the checkpoint, restore connectivity if it fails, then deploy again.`,
      context: {
        namespace: namespaceName,
        expectedCheckpoint: expectedCheckpoint.number,
        tables,
      },
    });
  }
  if (isCheckpointStillOwned(remoteState, expectedCheckpoint)) return undefined;

  const tables = skipRestoration(flow, restoration, runLog, namespaceName);
  return CLIError({
    code: "MIGRATION_CHECKPOINT_CONFLICT",
    message:
      `Migration checkpoint ${namespaceName}/${describeMigrationCheckpoint(expectedCheckpoint.number)} advanced concurrently to ${describeMigrationCheckpoint(remoteState.number)}. ` +
      "Skipping restoration for this namespace and aborting this deployment.",
    suggestion:
      (restricted
        ? `Another deploy changed the checkpoint, so the tables of namespace '${namespaceName}' keep the restrictions this deploy set (${RESTRICTION_EFFECT}). `
        : `Another deploy changed the checkpoint, so the table settings of namespace '${namespaceName}' are left unchanged. `) +
      `${describeSkippedTables(tables)}Wait for the other deploy to finish, run \`tailor tailordb migration status --namespace ${namespaceName}\` to see the checkpoint and any migration in progress, then check the tables before deploying again.`,
    context: {
      namespace: namespaceName,
      expectedCheckpoint: expectedCheckpoint.number,
      remoteCheckpoint: remoteState.number,
      tables,
    },
  });
}

function skipRestoration(
  flow: MigrationFlow,
  restoration: RestorationState,
  runLog: MigrationRunLog,
  namespaceName: string,
): string[] {
  const tables = skippedRestorationTables(
    namespaceName,
    restoration.snapshots,
    restoration.settings,
    restrictionHistoryOf(flow, runLog, namespaceName),
  );
  restoration.snapshots.delete(namespaceName);
  restoration.skipped.add(namespaceName);
  return tables;
}

function keepPartialMigrationsRestricted(
  flow: MigrationFlow,
  restoration: RestorationState,
  runLog: MigrationRunLog,
): void {
  const { pendingMigrations, inProgressMigrations } = flow.validation;
  for (const migration of pendingMigrations) {
    const resumed = inProgressMigrations[migration.namespace]?.number === migration.number;
    if (resumed && !runLog.reached.has(migration)) {
      runLog.partial.set(migration.namespace, migration);
    }
  }
  for (const [namespaceName, migration] of runLog.partial) {
    const tables = keepMigrationTablesRestricted(
      namespaceName,
      migration,
      restoration.snapshots,
      restoration.settings,
      restrictionHistoryOf(flow, runLog, namespaceName),
    );
    warnTablesLeftRestricted(
      `Migration ${namespaceName}/${formatMigrationNumber(migration.number)} is partially applied.`,
      [{ namespace: namespaceName, tables }],
    );
  }
}

async function restoreTables(
  flow: MigrationFlow,
  restoration: RestorationState,
  runLog: MigrationRunLog,
  restoreClient: OperatorClient,
): Promise<void> {
  const { migrationContext } = flow;
  await restoreMigrationRestrictions(
    restoreClient,
    restoration.snapshots,
    restoration.settings,
    migrationContext.tailorDBInputs,
    migrationContext.executorUsedTables,
    migrationContext.workspaceId,
    flow.phaseSettings.restricted,
  );
  flow.timeline?.finish();
  const namespacesWithRecords = new Set([
    ...runLog.recordedNamespaces,
    ...Object.keys(flow.validation.maintenanceModeCheckpoints),
  ]);
  for (const namespaceName of namespacesWithRecords) {
    if (!restoration.snapshots.has(namespaceName)) continue;
    await clearRecordAfterRelease(restoreClient, migrationContext.workspaceId, namespaceName);
  }
}

async function releaseHeldMaintenanceMode(
  flow: MigrationFlow,
  restoration: RestorationState,
  runLog: MigrationRunLog,
  releaseClient: OperatorClient,
): Promise<MaintenanceReport | undefined> {
  flow.timeline?.enter("restore");
  const unowned = await findUnownedMigrationCheckpoints(
    releaseClient,
    flow.migrationContext.workspaceId,
    restoration.checkpoints,
    "Leaving its table settings unchanged.",
  );
  for (const namespaceName of unowned.keys()) restoration.snapshots.delete(namespaceName);
  const [ownershipError, ...otherErrors] = unowned.values();
  for (const error of otherErrors) logger.warn(error.message);
  try {
    await restoreTables(flow, restoration, runLog, releaseClient);
  } catch (restorationError) {
    if (!ownershipError) throw restorationError;
    logger.warn(`Could not restore every TailorDB table: ${toError(restorationError).message}.`);
  }
  if (ownershipError) throw ownershipError;
  return finishMaintenance(flow);
}

async function restoreAfterMigrations(
  flow: MigrationFlow,
  restoration: RestorationState,
  runLog: MigrationRunLog,
  outcome: MigrationOutcome,
): Promise<readonly RestrictedTables[]> {
  try {
    await restoreTables(flow, restoration, runLog, flow.client);
    return [];
  } catch (restorationError) {
    if (!outcome.failure) throw restorationError;
    const unrestored = readUnrestoredTables(restorationError);
    const reason = `Could not restore every TailorDB table after the migration failed: ${toError(restorationError).message}.`;
    if (flow.phaseSettings.restricted) {
      warnTablesLeftRestricted(reason, unrestored, {
        namesUnknown: unrestored.every((entry) => entry.tables.length === 0),
      });
    } else {
      logger.warn(reason);
    }
    logger.log("The original migration error is reported below.");
    if (restorationError instanceof Error) {
      outcome.restorationFailures.restoration = restorationError;
    }
    return unrestored;
  }
}

function warnIncompleteRollbacks(
  flow: MigrationFlow,
  restoration: RestorationState,
  runLog: MigrationRunLog,
  unrestored: readonly RestrictedTables[],
): void {
  for (const { migration, tables, permissions } of runLog.unrolledBack) {
    const failedRestoration = unrestored.find((entry) => entry.namespace === migration.namespace);
    const lifted = new Set(
      restoration.skipped.has(migration.namespace) || failedRestoration?.tables.length === 0
        ? []
        : [
            ...Object.keys(restoration.snapshots.get(migration.namespace)?.tables ?? {}),
            ...(restoration.settings.get(migration.namespace)?.keys() ?? []),
          ].filter((tableName) => !failedRestoration?.tables.includes(tableName)),
    );
    // Restoration writes table definitions but not GraphQL permissions, so a failed
    // permission undo stays unreverted even for a table restoration lifted.
    if (permissions.length > 0) {
      logger.warn(
        `Migration ${migration.namespace}/${formatMigrationNumber(migration.number)} was not rolled back completely. GraphQL permissions needing manual repair in namespace '${migration.namespace}': ${permissions.join(", ")}.`,
      );
      logger.log(
        "Check the GraphQL permission of these tables in the workspace and set it back by hand.",
      );
    }
    const remaining = tables.filter((tableName) => !lifted.has(tableName));
    if (remaining.length === 0) continue;
    if (!flow.phaseSettings.restricted) {
      logger.warn(
        `Migration ${migration.namespace}/${formatMigrationNumber(migration.number)} was not rolled back completely. Tables needing manual repair in namespace '${migration.namespace}': ${remaining.join(", ")}.`,
      );
      logger.log(ROLLBACK_LEFTOVER_RECOVERY);
      continue;
    }
    warnTablesLeftRestricted(
      `Migration ${migration.namespace}/${formatMigrationNumber(migration.number)} was not rolled back completely.`,
      [{ namespace: migration.namespace, tables: remaining }],
      { recovery: ROLLBACK_LEFTOVER_RECOVERY },
    );
  }
}

function finishMaintenance(flow: MigrationFlow): MaintenanceReport | undefined {
  if (!flow.timeline) return undefined;
  const report = flow.timeline.report([...flow.migratingNamespaces]);
  logger.info(formatMaintenanceSummary(report));
  return report;
}

async function applyDeferredChanges(flow: MigrationFlow, deferred: DeferredChanges): Promise<void> {
  const { client, changeSet } = flow;
  for (const create of changeSet.type.creates) {
    const namespaceName = create.request.namespaceName;
    const tableName = create.request.tailordbType?.name;
    if (!namespaceName || !tableName) continue;
    if (!deferred.typeKeys.has(`${namespaceName}/${tableName}`)) continue;
    await client.createTailorDBType(create.request);
  }
  await Promise.all([
    ...changeSet.gqlPermission.creates
      .filter((create) =>
        deferred.gqlPermissionKeys.has(`${create.request.namespaceName}/${create.name}`),
      )
      .map((create) => client.createTailorDBGQLPermission(create.request)),
    ...changeSet.gqlPermission.updates
      .filter((update) =>
        deferred.gqlPermissionKeys.has(`${update.request.namespaceName}/${update.name}`),
      )
      .map((update) => client.updateTailorDBGQLPermission(update.request)),
  ]);
}

async function applyRemainingDeletions(flow: MigrationFlow): Promise<void> {
  const { client, changeSet } = flow;
  // Delete remaining GQL permissions that weren't deleted with their tables
  const remainingGqlPermissionDeletes = changeSet.gqlPermission.deletes.filter((del) => {
    const permKey = `${del.request.namespaceName}/${del.name}`;
    return !deletedResources.gqlPermissions.has(permKey);
  });
  if (remainingGqlPermissionDeletes.length > 0) {
    await Promise.all(
      remainingGqlPermissionDeletes.map((del) => client.deleteTailorDBGQLPermission(del.request)),
    );
  }

  // Delete tables outside the migrating namespaces (their GQL
  // permissions were just removed above; migration postPhases never see them)
  await Promise.all(
    changeSet.type.deletes
      .filter((del) => isOutsideMigrations(flow, del.request.namespaceName))
      .map((del) => client.deleteTailorDBType(del.request)),
  );
}

async function applyWithoutMigrations(
  client: OperatorClient,
  changeSet: TailorDBChangeSet,
): Promise<void> {
  await executeServicesCreation(client, changeSet);

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
    handleOptionalToRequiredError(error, OPTIONAL_TO_REQUIRED_SUGGESTIONS);
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
    changeSet.gqlPermission.deletes.map((del) => client.deleteTailorDBGQLPermission(del.request)),
  );
  await Promise.all(changeSet.type.deletes.map((del) => client.deleteTailorDBType(del.request)));
}

/**
 * Create and update the services and write their metadata labels
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
