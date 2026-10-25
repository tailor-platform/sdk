import { arg } from "@politty/zod";
import * as path from "pathe";
import { z } from "zod";
import { resourceTrn } from "#/cli/commands/deploy/label";
import {
  clearMaintenanceModeRecord,
  updateMigrationLabel,
} from "#/cli/commands/deploy/tailordb/migration";
import {
  assertNoActiveMigrationExecution,
  removeMigrationWorkflowResources,
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
  fetchRemoteMigrationState,
  isStaleMigrationInProgress,
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

type Resolution = "rollback" | "complete";

interface ResolveOptions {
  configPath?: string;
  resolution: Resolution;
  namespace?: string;
  yes?: boolean;
  workspaceId?: string;
  profile?: string;
}

type ResolveResult = {
  changed: boolean;
  workspaceId: string;
  namespace: string;
  resolution: Resolution;
  migrationNumber: number;
  checkpoint: number;
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
    now.inProgress?.executionId !== before.inProgress?.executionId
  ) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_STATE_CHANGED",
      message: `The migration state of namespace "${namespace}" changed while the command was running.`,
      suggestion: "Run the command again.",
    });
  }
}

/**
 * Settle a migration that an earlier deploy left partially applied.
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

  assertValidMigrationFiles(target.migrationsDir, namespace);

  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options.profile,
    workspaceId: options.workspaceId,
  });

  const state = await fetchRemoteMigrationState(
    client,
    resourceTrn(workspaceId, "tailordb", namespace),
  );
  if (state.inProgressInvalid) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_RECORD_UNREADABLE",
      message: `Namespace "${namespace}" records a partially applied migration that cannot be read.`,
      suggestion: `Run 'tailor tailordb migration status --namespace ${namespace}' to inspect the migration state.`,
    });
  }
  if (!state.inProgress || isStaleMigrationInProgress(state)) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_NO_IN_PROGRESS",
      message: `No migration is in progress for namespace "${namespace}".`,
      suggestion: `Run 'tailor tailordb migration status --namespace ${namespace}' to check the migration state.`,
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
      suggestion: `Run 'tailor tailordb migration status --namespace ${namespace}' to compare the checkpoint with the in-progress migration, and restore the changed label before resolving.`,
    });
  }

  const localHistoryId =
    reconstructSnapshotFromMigrations(target.migrationsDir, 0)?.rebaseline?.historyId ?? null;
  const firstRun = state.number === null && state.historyId === null && !state.historyIdInvalid;
  if (!firstRun && (state.historyIdInvalid || state.historyId !== localHistoryId)) {
    throw CLIError({
      code: "MIGRATION_RESOLVE_HISTORY_MISMATCH",
      message: `The migration history of namespace "${namespace}" on the workspace does not match the local migration history.`,
      suggestion:
        "Run the command from a checkout of the migration history that was deployed to the workspace.",
    });
  }

  const migrationNumber = state.inProgress.number;
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
  logger.log(`  In progress: ${styles.bold(formatMigrationNumber(migrationNumber))}`);
  logger.log(
    `  Resolution: ${styles.bold(options.resolution)} (schema of migration ${styles.bold(formatMigrationNumber(checkpoint))})`,
  );
  logger.log(`  Tables to create: ${styles.bold(String(plan.creates.length))}`);
  logger.log(`  Tables to update: ${styles.bold(String(plan.updates.length))}`);
  logger.log(`  Tables to delete: ${styles.bold(String(plan.deletes.length))}`);
  logger.newline();

  const migrationLabel = formatMigrationNumber(migrationNumber);
  if (plan.deletes.length > 0) {
    logger.warn("Existing data in deleted tables will be lost.");
  }
  if (options.resolution === "rollback") {
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

  try {
    await removeMigrationWorkflowResources(client, workspaceId, namespace, migrationNumber);
  } catch (error) {
    logger.warn(
      `Could not remove the temporary resources of migration ${formatMigrationNumber(migrationNumber)}: ` +
        `${error instanceof Error ? error.message : String(error)}. The next deploy removes them.`,
    );
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
    tables: { created: creates, updated: updates, deleted: deletes },
    gqlPermissions: {
      set: desiredGqlPermissions.map(({ typeName }) => typeName),
      deleted: gqlPermissionDeletes.map(({ typeName }) => typeName),
    },
  };
}

export const resolveCommand = defineAppCommand({
  name: "resolve",
  description: "Settle a migration that a failed deploy left partially applied.",
  notes: `Use this after a deploy failed partway through a migration whose \`migrate.ts\` exports \`steps\`. The failed migration stays in progress: when \`maintenanceMode\` is on in your config, the tables of its namespace stay in maintenance mode, and \`sync\` and \`rebaseline\` are refused, while \`set\` accepts only the number of the in-progress migration.

- \`--rollback\` sends the schema of the migration before the failed one. The next deploy runs the failed migration again from its first step. Data changes made by steps that already completed are not undone.
- \`--complete\` sends the schema of the failed migration itself and records it as completed, without running its \`migrate.ts\` again. Fix the data first (for example with \`tailor query\`), and make sure no record lacks a value for a field that becomes required.

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
