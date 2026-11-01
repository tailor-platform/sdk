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
import { loadConfig } from "#/cli/shared/config-loader";
import { CLIError } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { printMutationResult } from "#/cli/shared/mutation-result";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { getNamespacesWithMigrations, selectTargetNamespace } from "./config";
import {
  formatNamespaceMigrationHint,
  migrationCommandContext,
  type MigrationCommandContext,
} from "./hints";
import {
  fetchRemoteMigrationState,
  isStaleMigrationInProgress,
  matchesLocalMigrationHistory,
  migrationHistoryMismatchError,
  type MigrationResolution,
  type RemoteMigrationState,
} from "./remote-state";
import {
  assertMigrationNumberExists,
  assertValidMigrationFiles,
  formatMigrationNumber,
  reconstructSnapshotFromMigrations,
} from "./snapshot";
import { applySnapshotPlan, planSnapshotApply } from "./snapshot-apply";
import { assertMigrationsReproduceLocalTypes } from "./sync";
import { handleOptionalToRequiredError } from "./types";

interface ResolveOptions {
  configPath?: string;
  resolution: MigrationResolution;
  namespace?: string;
  yes?: boolean;
  workspaceId?: string;
  profile?: string;
}

type ResolveResult = {
  changed: boolean;
  workspaceId: string;
  namespace: string;
  resolution: MigrationResolution;
  migrationNumber: number;
  checkpoint: number;
  /** How the recorded `main` run stood; absent for a migration whose steps partly committed. */
  runStatus?: MigrationRunStatus;
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
    now.inProgress?.kind !== before.inProgress?.kind
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
      `Rolling back does not undo what the script of migration ${label} changed in existing fields, and deletes the tables and fields the migration introduced together with their data. ` +
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

  const loaded = await loadConfig(options.configPath);
  const configDir = path.dirname(loaded.config.path);
  const target = selectTargetNamespace(
    getNamespacesWithMigrations(loaded.config, configDir),
    options.namespace,
  );
  const { namespace } = target;

  assertValidMigrationFiles(target.migrationsDir, namespace, loaded.config.path);

  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options.profile,
    workspaceId: options.workspaceId,
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
  if (!state.inProgress || isStaleMigrationInProgress(state)) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_NO_IN_PROGRESS",
      message: `No migration is in progress for namespace "${namespace}".`,
      suggestion: `Run ${statusHint} to check the migration state.`,
    });
  }

  const currentCheckpoint = state.number ?? 0;
  const nextMigrationNumber = currentCheckpoint + 1;
  if (state.inProgress.number !== nextMigrationNumber) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_RECORD_INVALID",
      message: `Namespace "${namespace}" records migration ${formatMigrationNumber(state.inProgress.number)} as in progress, but its checkpoint is ${formatMigrationNumber(currentCheckpoint)}; the next migration to run would be ${formatMigrationNumber(nextMigrationNumber)}.`,
      details:
        "The checkpoint or the in-progress record changed after the deploy that started the migration wrote it.",
      suggestion: `Run ${statusHint} to compare the checkpoint with the in-progress migration, and restore the changed label before resolving.`,
    });
  }

  const localHistoryId =
    reconstructSnapshotFromMigrations(target.migrationsDir, 0)?.rebaseline?.historyId ?? null;
  if (!matchesLocalMigrationHistory(state, localHistoryId)) {
    throw migrationHistoryMismatchError({
      state,
      localHistoryId,
      namespace,
      code: "MIGRATION_RESOLVE_HISTORY_MISMATCH",
      suggestion:
        "Run the command from a checkout of the migration history that was deployed to the workspace.",
    });
  }

  const migrationNumber = state.inProgress.number;
  const migrationLabel = formatMigrationNumber(migrationNumber);
  const runStatus =
    state.inProgress.kind === "main"
      ? await readMigrationRunStatus(client, workspaceId, namespace, state.inProgress)
      : undefined;
  if (runStatus === "running") {
    throw retryCommandActiveError(
      `The run of migration ${namespace}/${migrationLabel} is still running.`,
      state.inProgress.executionId,
    );
  }
  const checkpoint = options.resolution === "rollback" ? migrationNumber - 1 : migrationNumber;
  assertMigrationNumberExists(target.migrationsDir, checkpoint);
  const snapshot = reconstructSnapshotFromMigrations(target.migrationsDir, checkpoint);
  if (!snapshot) {
    throw CLIError({
      code: "MIGRATION_BASELINE_NOT_FOUND",
      message: `No initial schema snapshot found in ${target.migrationsDir}. Expected 0000/schema.json.`,
      suggestion: "Create the initial schema snapshot first.",
    });
  }

  const manifestOptions = await assertMigrationsReproduceLocalTypes(loaded, target);
  const plan = await planSnapshotApply({ client, workspaceId, namespace, snapshot });

  logger.newline();
  logger.info(`Namespace: ${styles.bold(namespace)}`);
  logger.log(`  In progress: ${styles.bold(migrationLabel)}`);
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

  if (!options.yes) {
    const confirmation = await prompt.confirm({
      message: `Continue and ${options.resolution} migration ${formatMigrationNumber(migrationNumber)}?`,
      default: false,
    });
    if (!confirmation) {
      throw CLIError({
        code: "MIGRATION_RESOLVE_CANCELLED",
        message: "Migration resolve cancelled.",
      });
    }
    logger.newline();
  }

  await assertMigrationStateUnchanged({ client, workspaceId, namespace, before: state });
  await assertNoActiveMigrationExecution(client, workspaceId, namespace, migrationNumber);
  try {
    await applySnapshotPlan({ client, workspaceId, namespace, snapshot, manifestOptions, plan });
  } catch (error) {
    handleOptionalToRequiredError(error, [
      `The schema of migration ${migrationLabel} marks a field as required, but records still have no value for it.`,
      "Fill in those records first (for example with 'tailor query'), then run the command again; the migration stays in progress until the update goes through.",
    ]);
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
  notes: `Use this after a deploy failed partway through a migration whose \`migrate.ts\` exports \`steps\`, or after a deploy could not confirm whether the script of a migration ran (\`MIGRATION_OUTCOME_UNKNOWN\`). The migration stays in progress: when \`maintenanceMode\` is on in your config, the tables of its namespace stay in maintenance mode, and \`sync\` and \`rebaseline\` are refused, while \`set\` accepts only the number of the in-progress migration. A deploy stops before changing anything while a run it could not confirm is not settled.

- \`--rollback\` sends the schema of the migration before the failed one. The next deploy runs the failed migration again, from its first step for a script that exports \`steps\`. Data changes the script already made are not undone.
- \`--complete\` sends the schema of the failed migration itself and records it as completed, without running its \`migrate.ts\` again. Fix the data first (for example with \`tailor query\`), and make sure no record lacks a value for a field that becomes required.

For a run that a deploy could not confirm, the command reads how the run ended and shows it before asking for confirmation: use \`--complete\` when it succeeded, and \`--rollback\` when it failed, was canceled, or did not start. It refuses while the run is still running, and warns when the option you chose does not fit how the run ended.

Both options remove the in-progress record, take the tables out of maintenance mode, and remove the temporary resources of the failed run, so \`deploy\` and the other migration commands work again. As with \`tailordb migration sync\`, the local migration history must reproduce the current table definitions. If sending the schema stops partway, run the command again.`,
  args: z.strictObject({
    ...deploymentArgs,
    ...confirmationArgs,
    rollback: arg(z.boolean().default(false), {
      description: "Return the namespace to the schema before the in-progress migration",
    }),
    complete: arg(z.boolean().default(false), {
      description: "Apply the schema of the in-progress migration and mark it as completed",
    }),
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Target TailorDB namespace (required if multiple namespaces exist)",
    }),
  }),
  run: async (args) => {
    if (args.rollback === args.complete) {
      throw CLIError({
        code: "MIGRATION_RESOLVE_DIRECTION_REQUIRED",
        message: "Specify exactly one of --rollback or --complete.",
      });
    }
    await assertWritable({ profile: args.profile });
    const resolved = await resolve({
      configPath: args.config,
      resolution: args.rollback ? "rollback" : "complete",
      namespace: args.namespace,
      yes: args.yes,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
    printMutationResult(resolved);
  },
});
