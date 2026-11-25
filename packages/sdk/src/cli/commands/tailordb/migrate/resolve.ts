import { arg } from "@politty/zod";
import * as path from "pathe";
import { z } from "zod";
import { resourceTrn } from "#/cli/commands/deploy/label";
import {
  clearMaintenanceModeRecord,
  removeRunResources,
  updateMigrationLabel,
} from "#/cli/commands/deploy/tailordb/migration";
import {
  assertNoActiveMigrationExecution,
  formatMigrationExecutionsHint,
  readMigrationRunStatus,
  retryCommandActiveError,
  settlingResolution,
  type MigrationRunStatus,
} from "#/cli/commands/deploy/tailordb/migration-workflow";
import { confirmationArgs, deploymentArgs } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { configOf } from "#/cli/shared/config-file";
import { loadConfigFile, type LoadedConfigFile } from "#/cli/shared/config-loader";
import { CLIError, formatCommandHint } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { printMutationResult } from "#/cli/shared/mutation-result";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import {
  getNamespacesWithMigrations,
  selectTargetNamespace,
  type NamespaceWithMigrations,
} from "./config";
import {
  formatNamespaceMigrationHint,
  migrationCommandContext,
  migrationContextArgs,
  type MigrationCommandContext,
} from "./hints";
import {
  fetchRemoteMigrationState,
  formatMigrationResolveHint,
  isStaleMigrationInProgress,
  matchesLocalMigrationHistory,
  migrationHistoryMismatchError,
  type MigrationResolution,
  type RemoteMigrationState,
} from "./remote-state";
import { formatRemoteVerificationResults, verifyRemoteSchema } from "./schema-checks";
import {
  assertMigrationNumberExists,
  assertValidMigrationFiles,
  formatMigrationNumber,
  getLatestMigrationNumber,
  reconstructSnapshotFromMigrations,
} from "./snapshot";
import { applySnapshotPlan, planSnapshotApply } from "./snapshot-apply";
import { assertMigrationsReproduceLocalTypes } from "./sync";
import { handleOptionalToRequiredError } from "./types";

type ResolveMode = MigrationResolution | "maintenance";

interface ResolveOptions {
  configPath?: string | undefined;
  resolution: ResolveMode;
  namespace?: string | undefined;
  yes?: boolean | undefined;
  workspaceId?: string | undefined;
  profile?: string | undefined;
}

type ResolveResult = {
  changed: boolean;
  workspaceId: string;
  namespace: string;
  resolution: ResolveMode;
  migrationNumber: number;
  checkpoint: number;
  /** Set when no migration was recorded as in progress, but a deploy left the Pre-phase or maintenance mode of this one in place. */
  interrupted?: true | undefined;
  /** How the recorded `main` run stood; absent for a migration whose steps partly committed. */
  runStatus?: MigrationRunStatus | undefined;
  tables: { created: string[]; updated: string[]; deleted: string[] };
  gqlPermissions: { set: string[]; deleted: string[] };
};

type AssertStateUnchangedParams = {
  client: OperatorClient;
  workspaceId: string;
  namespace: string;
  before: RemoteMigrationState;
};

async function assertMigrationStateUnchanged(params: AssertStateUnchangedParams): Promise<void> {
  const { client, workspaceId, namespace, before } = params;
  const now = await fetchRemoteMigrationState(
    client,
    resourceTrn(workspaceId, "tailordb", namespace),
  );
  if (
    now.number !== before.number ||
    now.historyId !== before.historyId ||
    now.inProgress?.number !== before.inProgress?.number ||
    now.inProgress?.executionId !== before.inProgress?.executionId ||
    now.inProgress?.kind !== before.inProgress?.kind ||
    now.maintenanceModeCheckpoint !== before.maintenanceModeCheckpoint
  ) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_STATE_CHANGED",
      message: `The migration state of namespace "${namespace}" changed while the command was running.`,
      suggestion: "Run the command again.",
    });
  }
}

type MainRunResolution = {
  namespace: string;
  migrationNumber: number;
  resolution: MigrationResolution;
  runStatus: MigrationRunStatus;
  /** Config and workspace selection of this run, kept in the command it suggests */
  commandContext: MigrationCommandContext;
};

/**
 * Warn about what settling a `main` run the chosen way does, and against the
 * way that does not fit how the run stood.
 * @param params - The run and how it is settled
 */
function warnMainRunResolution(params: MainRunResolution): void {
  const { namespace, migrationNumber, resolution, runStatus, commandContext } = params;
  const label = formatMigrationNumber(migrationNumber);
  const fitting = settlingResolution(runStatus);
  if (resolution === "rollback") {
    logger.warn(
      `Rolling back does not undo what the script of migration ${label} changed in existing fields. It removes the fields the migration introduced and deletes the tables it introduced together with their data. ` +
        `When migration ${label} is deployed again, its script runs again, so make sure it is safe to run twice.`,
    );
    if (fitting === "complete") {
      logger.warn(
        `The run of migration ${label} succeeded. To keep what its script wrote, run the command with --complete instead.`,
      );
    }
  } else {
    logger.warn(
      `Completing applies the schema of migration ${label} without running its migrate.ts again; do this only after the data it needs is in place.`,
    );
    if (fitting === "rollback") {
      logger.warn(
        `The run of migration ${label} did not succeed, so the data it migrates may not be in place. ` +
          "To run the script again on the next deploy, run the command with --rollback instead.",
      );
    }
  }
  if (runStatus === "unknown") {
    logger.warn(
      `Whether the run of migration ${label} succeeded could not be confirmed. ` +
        `Check it with ${formatMigrationExecutionsHint(namespace, migrationNumber, commandContext)} before you continue.`,
    );
  }
}

/**
 * Refuse to settle a namespace whose recorded migration history is not the local one.
 * @param state - Remote migration state of the namespace
 * @param target - Namespace and its local migration files
 */
function assertLocalMigrationHistoryMatches(
  state: RemoteMigrationState,
  target: NamespaceWithMigrations,
): void {
  const localHistoryId =
    reconstructSnapshotFromMigrations(target.migrationsDir, 0)?.rebaseline?.historyId ?? null;
  if (matchesLocalMigrationHistory(state, localHistoryId)) return;
  throw migrationHistoryMismatchError({
    state,
    localHistoryId,
    namespace: target.namespace,
    code: "MIGRATION_RESOLVE_HISTORY_MISMATCH",
    suggestion:
      "Run the command from a checkout of the migration history that was deployed to the workspace.",
  });
}

/**
 * Rebuild the schema a checkpoint stands for from the local migration files.
 * @param target - Namespace and its local migration files
 * @param checkpoint - Migration number whose schema is rebuilt
 * @returns The schema snapshot at the checkpoint
 */
function loadCheckpointSnapshot(target: NamespaceWithMigrations, checkpoint: number) {
  assertMigrationNumberExists(target.migrationsDir, checkpoint);
  const snapshot = reconstructSnapshotFromMigrations(target.migrationsDir, checkpoint);
  if (!snapshot) {
    throw CLIError({
      code: "MIGRATION_BASELINE_NOT_FOUND",
      message: `No initial schema snapshot found in ${target.migrationsDir}. Expected 0000/schema.json.`,
      suggestion: "Create the initial schema snapshot first.",
    });
  }
  return snapshot;
}

/**
 * Ask for confirmation unless `--yes` was given.
 * @param options - Command options
 * @param message - Question to ask
 */
async function confirmResolve(options: ResolveOptions, message: string): Promise<void> {
  if (options.yes) return;
  const confirmation = await prompt.confirm({ message, default: false });
  if (!confirmation) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_CANCELLED",
      message: "Migration resolve cancelled.",
    });
  }
  logger.newline();
}

type ReleaseMaintenanceModeParams = {
  options: ResolveOptions;
  loaded: LoadedConfigFile;
  target: NamespaceWithMigrations;
  client: OperatorClient;
  workspaceId: string;
  state: RemoteMigrationState;
  commandContext: MigrationCommandContext;
  statusHint: string;
};

/**
 * Take the tables out of the maintenance mode a deploy left in place after its migration was
 * committed, without moving the checkpoint.
 * @param params - Command options, target namespace, and the remote state read for it
 * @returns What was sent to the remote and the unchanged checkpoint
 */
async function releaseMaintenanceMode(
  params: ReleaseMaintenanceModeParams,
): Promise<ResolveResult> {
  const { options, loaded, target, client, workspaceId, state, commandContext, statusHint } =
    params;
  const { namespace } = target;
  const checkpoint = state.number ?? 0;

  if (state.inProgress !== null && !isStaleMigrationInProgress(state)) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_MAINTENANCE_IN_PROGRESS",
      message: `Migration ${formatMigrationNumber(state.inProgress.number)} of namespace "${namespace}" is recorded as in progress.`,
      suggestion: `Settle it with ${formatMigrationResolveHint("rollback", namespace, commandContext)} or ${formatMigrationResolveHint("complete", namespace, commandContext)}, which also take the tables out of maintenance mode.`,
    });
  }
  if (state.maintenanceModeCheckpoint !== checkpoint) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_NO_MAINTENANCE_RECORD",
      message: `Namespace "${namespace}" has no record of tables left in maintenance mode at checkpoint ${formatMigrationNumber(checkpoint)}.`,
      suggestion: `Run ${statusHint} to check the migration state.`,
    });
  }

  const config = configOf(loaded);
  assertValidMigrationFiles(target.migrationsDir, namespace, config.path);
  assertLocalMigrationHistoryMatches(state, target);

  if (state.cleanupCheckpoint === checkpoint) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_MAINTENANCE_CLEANUP_PENDING",
      message: `A table that migration ${formatMigrationNumber(checkpoint)} of namespace "${namespace}" removes is not deleted yet.`,
      suggestion: `Run ${formatCommandHint({ command: "tailor", args: ["deploy", ...migrationContextArgs(commandContext)] })}, which deletes the table, takes the tables out of maintenance mode, and removes both records.`,
    });
  }

  const verification = (
    await verifyRemoteSchema(client, workspaceId, [target], config, [], {
      acceptInterruptedMigration: true,
    })
  )[0];
  if (verification?.interruptedMigration !== undefined) {
    const interrupted = formatMigrationNumber(verification.interruptedMigration);
    throw CLIError({
      code: "MIGRATION_RESOLVE_MAINTENANCE_INTERRUPTED",
      message: `A deploy left the pre-migration schema of migration ${interrupted} of namespace "${namespace}" in place before it recorded the migration.`,
      suggestion: `Settle it with ${formatMigrationResolveHint("rollback", namespace, commandContext)}, or deploy again to run migration ${interrupted}.`,
    });
  }
  if (verification?.hasDrift) {
    logger.error("Remote schema drift detected:");
    logger.log(formatRemoteVerificationResults([verification]));
    throw CLIError({
      code: "MIGRATION_RESOLVE_MAINTENANCE_DRIFT",
      message: `The tables of namespace "${namespace}" differ from checkpoint ${formatMigrationNumber(checkpoint)} in more than the maintenance mode.`,
      suggestion: `Run ${formatNamespaceMigrationHint({ ...commandContext, subcommand: ["validate"], namespace })} to see the difference.`,
    });
  }
  if (!verification?.leftInMaintenanceMode) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_MAINTENANCE_UNVERIFIED",
      message: `The tables of namespace "${namespace}" could not be compared with checkpoint ${formatMigrationNumber(checkpoint)}, for example because the local migration files do not reach that checkpoint.`,
      suggestion: `Run ${statusHint} to compare the workspace with the local migration history.`,
    });
  }

  const snapshot = loadCheckpointSnapshot(target, checkpoint);
  const manifestOptions = await assertMigrationsReproduceLocalTypes(loaded, target);
  const plan = await planSnapshotApply({ client, workspaceId, namespace, snapshot });

  logger.newline();
  logger.info(`Namespace: ${styles.bold(namespace)}`);
  logger.log(
    `  Maintenance mode left at checkpoint: ${styles.bold(formatMigrationNumber(checkpoint))}`,
  );
  logger.log(`  Tables to update: ${styles.bold(String(plan.updates.length))}`);
  logger.newline();
  logger.warn(
    "Make sure no deploy to this workspace is running: a running deploy holds the tables in maintenance mode on purpose.",
  );
  logger.newline();

  await confirmResolve(
    options,
    `Take the tables of namespace ${namespace} out of maintenance mode?`,
  );

  await assertMigrationStateUnchanged({ client, workspaceId, namespace, before: state });
  try {
    await applySnapshotPlan({ client, workspaceId, namespace, snapshot, manifestOptions, plan });
  } catch (error) {
    handleOptionalToRequiredError(
      error,
      "The schema of the checkpoint marks a field as required, but records still have no value for it. " +
        "Fill in those records first (for example with `tailor query`), then run the command again.",
    );
  }
  await assertMigrationStateUnchanged({ client, workspaceId, namespace, before: state });
  await clearMaintenanceModeRecord(client, workspaceId, namespace);

  logger.success(
    `Took the tables of namespace ${styles.bold(namespace)} out of maintenance mode; the checkpoint stays ${styles.bold(formatMigrationNumber(checkpoint))}.`,
  );

  const { creates, updates, deletes, desiredGqlPermissions, gqlPermissionDeletes } = plan;
  return {
    changed: true,
    workspaceId,
    namespace,
    resolution: "maintenance",
    migrationNumber: checkpoint,
    checkpoint,
    tables: { created: creates, updated: updates, deleted: deletes },
    gqlPermissions: {
      set: desiredGqlPermissions.map(({ typeName }) => typeName),
      deleted: gqlPermissionDeletes.map(({ typeName }) => typeName),
    },
  };
}

/**
 * Settle a migration that an earlier deploy left partially applied, or whose
 * `main` run it could not settle.
 *
 * Rolling back returns the namespace to the schema of the migration before it;
 * completing applies the schema of the migration itself. Either way the
 * in-progress record is removed, so deploy and the other migration commands
 * work again.
 * @param options - Command options
 * @returns What was sent to the remote and where the checkpoint ended up
 */
async function resolve(options: ResolveOptions): Promise<ResolveResult> {
  logBetaWarning("tailordb migration");

  const loaded = await loadConfigFile(options.configPath);
  const config = configOf(loaded);
  const configDir = path.dirname(config.path);
  const target = selectTargetNamespace(
    getNamespacesWithMigrations(config, configDir),
    options.namespace,
  );
  const { namespace } = target;

  assertValidMigrationFiles(target.migrationsDir, namespace, config.path);

  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options.profile,
    workspaceId: options.workspaceId,
    clientOptions: { createsPlannedResources: true },
  });
  const commandContext = migrationCommandContext({
    configPath: options.configPath,
    workspaceId,
    profile: options.profile,
  });
  const statusHint = formatNamespaceMigrationHint({
    ...commandContext,
    subcommand: ["status"],
    namespace,
  });

  const state = await fetchRemoteMigrationState(
    client,
    resourceTrn(workspaceId, "tailordb", namespace),
  );
  if (state.inProgressInvalid) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_RECORD_UNREADABLE",
      message: `Namespace "${namespace}" records a partially applied migration that cannot be read.`,
      suggestion: `Run ${statusHint} to inspect the migration state.`,
    });
  }
  if (options.resolution === "maintenance") {
    return releaseMaintenanceMode({
      options,
      loaded,
      target,
      client,
      workspaceId,
      state,
      commandContext,
      statusHint,
    });
  }
  const currentCheckpoint = state.number ?? 0;
  const nextMigrationNumber = currentCheckpoint + 1;
  const staleRecord = isStaleMigrationInProgress(state) ? state.inProgress : null;
  const record = staleRecord ? null : state.inProgress;
  const verification =
    !record && options.resolution === "rollback"
      ? (
          await verifyRemoteSchema(client, workspaceId, [target], config, [], {
            acceptInterruptedMigration: true,
          })
        )[0]
      : undefined;
  const interrupted =
    verification !== undefined &&
    (verification.interruptedMigration === nextMigrationNumber ||
      (verification.leftInMaintenanceMode &&
        !verification.hasDrift &&
        getLatestMigrationNumber(target.migrationsDir) >= nextMigrationNumber));
  if (!record && !interrupted) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_NO_IN_PROGRESS",
      message: `No migration is in progress for namespace "${namespace}".`,
      suggestion: `Run ${statusHint} to check the migration state.`,
    });
  }

  if (record && record.number !== nextMigrationNumber) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_RECORD_INVALID",
      message: `Namespace "${namespace}" records migration ${formatMigrationNumber(record.number)} as in progress, but its checkpoint is ${formatMigrationNumber(currentCheckpoint)}; the next migration to run would be ${formatMigrationNumber(nextMigrationNumber)}.`,
      details:
        "The checkpoint or the in-progress record changed after the deploy that started the migration wrote it.",
      suggestion: `Run ${statusHint} to compare the checkpoint with the in-progress migration, and restore the changed label before resolving.`,
    });
  }

  assertLocalMigrationHistoryMatches(state, target);

  const migrationNumber = nextMigrationNumber;
  const migrationLabel = formatMigrationNumber(migrationNumber);
  const runStatus =
    record?.kind === "main"
      ? await readMigrationRunStatus(client, workspaceId, namespace, record)
      : undefined;
  if (runStatus === "running") {
    throw retryCommandActiveError(
      `The run of migration ${namespace}/${migrationLabel} is still running.`,
      record?.executionId,
    );
  }
  const resolution: MigrationResolution = options.resolution;
  const checkpoint = resolution === "rollback" ? migrationNumber - 1 : migrationNumber;
  const snapshot = loadCheckpointSnapshot(target, checkpoint);

  const manifestOptions = await assertMigrationsReproduceLocalTypes(loaded, target);
  const plan = await planSnapshotApply({ client, workspaceId, namespace, snapshot });

  logger.newline();
  logger.info(`Namespace: ${styles.bold(namespace)}`);
  logger.log(
    interrupted
      ? `  Interrupted: ${styles.bold(migrationLabel)} (not recorded as in progress)`
      : `  In progress: ${styles.bold(migrationLabel)}`,
  );
  if (runStatus) logger.log(`  Run: ${styles.bold(runStatus)}`);
  logger.log(
    `  Resolution: ${styles.bold(options.resolution)} (schema of migration ${styles.bold(formatMigrationNumber(checkpoint))})`,
  );
  logger.log(`  Tables to create: ${styles.bold(String(plan.creates.length))}`);
  logger.log(`  Tables to update: ${styles.bold(String(plan.updates.length))}`);
  logger.log(`  Tables to delete: ${styles.bold(String(plan.deletes.length))}`);
  logger.newline();

  if (plan.deletes.length > 0) {
    logger.warn("Existing data in deleted tables will be lost.");
  }
  if (runStatus) {
    warnMainRunResolution({
      namespace,
      migrationNumber,
      resolution: options.resolution,
      runStatus,
      commandContext,
    });
  } else if (interrupted) {
    logger.warn(
      `No deploy recorded migration ${migrationLabel} as in progress, but its pre-migration schema or maintenance mode is still in place. ` +
        "A deploy that is still running looks the same until it records the migration, so make sure no deploy to this workspace is running.",
    );
    logger.warn(
      `Rolling back does not undo data changes a script of migration ${migrationLabel} may already have made. ` +
        `When migration ${migrationLabel} is deployed again, it runs again from the start.`,
    );
  } else if (options.resolution === "rollback") {
    logger.warn(
      `Rolling back does not undo the data changes made by steps of migration ${migrationLabel} that already completed. ` +
        `When migration ${migrationLabel} is deployed again, its steps run again from the first step, so make sure every step is safe to run twice.`,
    );
  } else {
    logger.warn(
      `Completing applies the schema of migration ${migrationLabel} without running its migrate.ts again; do this only after the data it needs is in place.`,
    );
  }
  logger.newline();

  await confirmResolve(
    options,
    `Continue and ${options.resolution} migration ${formatMigrationNumber(migrationNumber)}?`,
  );

  await assertMigrationStateUnchanged({ client, workspaceId, namespace, before: state });
  await assertNoActiveMigrationExecution(client, workspaceId, namespace, migrationNumber);
  try {
    await applySnapshotPlan({ client, workspaceId, namespace, snapshot, manifestOptions, plan });
  } catch (error) {
    handleOptionalToRequiredError(
      error,
      `The schema of migration ${migrationLabel} marks a field as required, but records still have no value for it. ` +
        `Fill in those records first (for example with \`tailor query\`), then run the command again${interrupted ? "." : "; the migration stays in progress until the update goes through."}`,
    );
  }

  if (state.maintenanceModeCheckpoint !== null) {
    await clearMaintenanceModeRecord(client, workspaceId, namespace);
  }

  const labelChanged = await updateMigrationLabel(
    client,
    workspaceId,
    namespace,
    checkpoint,
    snapshot.rebaseline?.historyId,
  );

  await removeRunResources(client, workspaceId, namespace, migrationNumber);
  if (staleRecord) {
    await removeRunResources(client, workspaceId, namespace, staleRecord.number);
  }

  logger.success(
    `Resolved migration ${styles.bold(formatMigrationNumber(migrationNumber))} of namespace ${styles.bold(namespace)} (${options.resolution}); the checkpoint is ${styles.bold(formatMigrationNumber(checkpoint))}.`,
  );

  const { creates, updates, deletes, desiredGqlPermissions, gqlPermissionDeletes } = plan;
  return {
    changed:
      creates.length +
        updates.length +
        deletes.length +
        desiredGqlPermissions.length +
        gqlPermissionDeletes.length >
        0 || labelChanged,
    workspaceId,
    namespace,
    resolution: options.resolution,
    migrationNumber,
    checkpoint,
    ...(interrupted ? { interrupted } : {}),
    ...(runStatus ? { runStatus } : {}),
    tables: { created: creates, updated: updates, deleted: deletes },
    gqlPermissions: {
      set: desiredGqlPermissions.map(({ typeName }) => typeName),
      deleted: gqlPermissionDeletes.map(({ typeName }) => typeName),
    },
  };
}

export const resolveCommand = defineAppCommand({
  name: "resolve",
  description:
    "Settle a migration that a failed deploy left partially applied, or whose run a deploy could not confirm.",
  notes: `Use this after a deploy failed partway through a migration whose \`migrate.ts\` exports \`steps\`, or after a deploy could not confirm whether the script of a migration ran (\`MIGRATION_OUTCOME_UNKNOWN\`). The migration stays in progress: when \`maintenanceMode\` is on in your config, the tables of its namespace stay in maintenance mode, and the other migration commands that move the checkpoint are refused. A deploy stops before changing anything while a run it could not confirm is not settled.

- \`--rollback\` sends the schema of the migration before the failed one. The next deploy runs the failed migration again, from its first step for a script that exports \`steps\`. Data changes the script already made are not undone.
- \`--complete\` sends the schema of the failed migration itself and records it as completed, without running its \`migrate.ts\` again. Fix the data first (for example with \`tailor query\`), and make sure no record lacks a value for a field that becomes required.

For a run that a deploy could not confirm, the command reads how the run ended and shows it before asking for confirmation: use \`--complete\` when it succeeded, and \`--rollback\` when it failed, was canceled, or did not start. It refuses while the run is still running, and warns when the option you chose does not fit how the run ended.

\`--rollback\` also settles a migration that no deploy recorded as in progress, but whose pre-migration schema or maintenance mode a deploy left in place, for example because the deploy stopped before recording it. See "Settling a migration that stays in progress" in the TailorDB Migrations guide for when it runs.

\`--maintenance\` is for a namespace whose checkpoint a deploy committed but whose tables it left in maintenance mode, with no migration in progress. It sends the schema of the checkpoint to restore the tables' settings and removes the maintenance mode record, without moving the checkpoint. It cannot be combined with the other two options, and it refuses when a migration is in progress, when no record names the current checkpoint, when a table the committed migration removes is not deleted yet (a deploy deletes it), when a deploy was interrupted before it recorded the next migration (settle it with \`--rollback\`), or when a table differs from the checkpoint in more than maintenance mode, printing the difference.

Both \`--rollback\` and \`--complete\` remove the in-progress record, take the tables out of maintenance mode, and remove the temporary resources of the failed run, so \`deploy\` and the other migration commands work again. As with \`tailordb migration sync\`, the local migration history must reproduce the current table definitions. If sending the schema stops partway, run the command again.`,
  args: z.strictObject({
    ...deploymentArgs,
    ...confirmationArgs,
    rollback: arg(z.boolean().default(false), {
      description: "Return the namespace to the schema before the in-progress migration",
    }),
    complete: arg(z.boolean().default(false), {
      description: "Apply the schema of the in-progress migration and mark it as completed",
    }),
    maintenance: arg(z.boolean().default(false), {
      description:
        "Take the tables out of the maintenance mode a deploy left in place after its migration was committed",
    }),
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Target TailorDB namespace (required if multiple namespaces exist)",
    }),
  }),
  run: async (args) => {
    if ([args.rollback, args.complete, args.maintenance].filter(Boolean).length !== 1) {
      throw CLIError({
        code: "MIGRATION_RESOLVE_DIRECTION_REQUIRED",
        message: "Specify exactly one of --rollback, --complete or --maintenance.",
      });
    }
    await assertWritable({ profile: args.profile });
    const resolved = await resolve({
      configPath: args.config,
      resolution: args.maintenance ? "maintenance" : args.rollback ? "rollback" : "complete",
      namespace: args.namespace,
      yes: args.yes,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
    printMutationResult(resolved);
  },
});
