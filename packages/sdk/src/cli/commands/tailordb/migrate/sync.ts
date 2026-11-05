import { arg } from "@politty/zod";
import * as path from "pathe";
import { z } from "zod";
import { resourceTrn } from "#/cli/commands/deploy/label";
import { updateMigrationLabel } from "#/cli/commands/deploy/tailordb/migration";
import { confirmationArgs, deploymentArgs } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { CLIError } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { printMutationResult } from "#/cli/shared/mutation-result";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { subscribesToEvents } from "#/cli/shared/publish-events";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { PluginManager } from "#/plugin/manager";
import {
  getNamespacesWithMigrations,
  selectTargetNamespace,
  type NamespaceWithMigrations,
} from "./config";
import { formatMigrationDiff, hasChanges } from "./diff-calculator";
import { migrationCommandContext } from "./hints";
import { parseMigrationNumberArg } from "./migration-number";
import {
  assertLocalMigrationHistory,
  assertNoMigrationInProgress,
  fetchRemoteMigrationState,
} from "./remote-state";
import {
  assertMigrationNumberExists,
  assertValidMigrationFiles,
  compareLocalTypesWithSnapshot,
  createSnapshotFromLocalTypes,
  formatMigrationNumber,
  reconstructSnapshotFromMigrations,
} from "./snapshot";
import { applySnapshotPlan, planSnapshotApply } from "./snapshot-apply";
import { handleOptionalToRequiredError } from "./types";
import type { GenerateAllManifestsOptions } from "./snapshot-manifest";

interface SyncOptions {
  configPath?: string;
  number: string;
  namespace?: string;
  yes?: boolean;
  force: boolean;
  workspaceId?: string;
  profile?: string;
}

/**
 * Verify that replaying the full migration history reproduces the current
 * local table definitions, before anything is sent to the remote.
 *
 * Sync force-applies a snapshot reconstructed from the migration history, so
 * the history itself must be trustworthy. When the reconstruction at the
 * latest migration does not match the schema defined in the local table files,
 * either the migration files were edited incorrectly or a schema change has
 * not been recorded as a migration yet — and overwriting the remote with an
 * unverified snapshot could destroy data. Fails before any RPC is issued.
 *
 * Returns the manifest generation options deploy would use for this
 * namespace (executor-driven publishRecordEvents and namespace
 * gqlOperations), so the synced manifests match what deploy produces.
 * @param loaded - Result of `loadConfig` (config and plugins)
 * @param target - Namespace whose migration history is being synced
 * @returns Options for `generateAllTypeManifestsFromSnapshot`
 */
export async function assertMigrationsReproduceLocalTypes(
  loaded: Awaited<ReturnType<typeof loadConfig>>,
  target: NamespaceWithMigrations,
): Promise<GenerateAllManifestsOptions> {
  const { config, plugins } = loaded;
  const pluginManager = plugins.length > 0 ? new PluginManager(plugins) : undefined;
  const { defineApplication, generatePluginFilesIfNeeded } =
    await import("#/cli/services/application");
  const application = defineApplication({ config, pluginManager });

  const tailordbService = application.tailorDBServices.find(
    (s) => s.namespace === target.namespace,
  );
  if (!tailordbService) {
    throw CLIError({
      code: "TAILORDB_NAMESPACE_NOT_FOUND",
      message: `No TailorDB service found for namespace "${target.namespace}"`,
    });
  }
  // Load every namespace (not just the target): plugin executors are
  // registered while tables load, and may trigger on the target's tables.
  for (const service of application.tailorDBServices) {
    await service.loadTypes();
    await service.processNamespacePlugins();
  }

  // Mirror loadApplication: plugin-generated executor files must be loaded
  // too, or publishRecordEvents would be applied as false for the tables
  // their record triggers depend on.
  const pluginExecutorFiles = generatePluginFilesIfNeeded(
    pluginManager,
    application.tailorDBServices,
    config.path,
  );
  const executorService =
    application.executorService ??
    (pluginExecutorFiles.length > 0
      ? (await import("#/cli/services/executor/service")).createExecutorService({
          config: { files: [] },
          baseDir: path.dirname(config.path),
        })
      : undefined);
  await executorService?.loadExecutors();
  if (pluginExecutorFiles.length > 0) {
    await executorService?.loadPluginExecutorFiles([...pluginExecutorFiles]);
  }
  const executorUsedTables = new Set<string>();
  for (const executor of Object.values(executorService?.executors ?? {})) {
    if (!subscribesToEvents(executor)) continue;
    if (executor.trigger.kind === "tailordb") {
      executorUsedTables.add(executor.trigger.tableName);
    }
  }
  const manifestOptions: GenerateAllManifestsOptions = {
    executorUsedTables,
    namespaceGqlOperations: tailordbService.config.gqlOperations,
  };

  const latestSnapshot = reconstructSnapshotFromMigrations(target.migrationsDir);
  if (!latestSnapshot) {
    return manifestOptions; // No migrations at all — reported by the caller's snapshot check.
  }
  const currentSnapshot = createSnapshotFromLocalTypes(tailordbService.types, target.namespace);
  const diff = compareLocalTypesWithSnapshot(
    latestSnapshot,
    currentSnapshot.tables,
    target.namespace,
  );
  if (!hasChanges(diff)) {
    return manifestOptions;
  }

  logger.error(
    `Migration history does not reproduce the current local schema for namespace ${styles.bold(target.namespace)}:`,
  );
  logger.log(formatMigrationDiff(diff));
  logger.newline();
  logger.info("This usually means one of the following:");
  logger.info(
    "  - Migration files were edited and replaying them no longer matches the table definitions — fix the migration files.",
    { mode: "plain" },
  );
  logger.info(
    "  - Table definitions changed without a new migration — run 'tailor tailordb migration generate' first.",
    { mode: "plain" },
  );
  logger.newline();
  throw CLIError({
    code: "MIGRATION_HISTORY_MISMATCH",
    message:
      "Refusing to continue: the migration history must reproduce the current local schema before it can be applied to the remote.",
    suggestion: "Generate a migration for the pending schema changes first.",
  });
}

type SyncResult = {
  changed: boolean;
  workspaceId: string;
  namespace: string;
  previousMigrationNumber: number | null;
  migrationNumber: number;
  historyId: string | null;
  tables: { created: string[]; updated: string[]; deleted: string[] };
  gqlPermissions: { set: string[]; deleted: string[] };
};

/**
 * Sync remote TailorDB schema to a specific migration snapshot.
 *
 * Reconstructs the schema state at `<number>` from `0000/schema.json` + diffs,
 * then issues create/update/delete RPCs so the remote matches that snapshot.
 * Updates the migration label to `<number>` on success. Before any remote
 * mutation, verifies that the migration history reproduces the current local
 * table definitions (see {@link assertMigrationsReproduceLocalTypes}).
 *
 * Intended for recovering from drift introduced by `deploy --no-schema-check`,
 * and for moving a checkpoint that `deploy` refuses as not in the local
 * migration history back to that history on purpose.
 * @param options - Command options
 * @returns What the sync sent to the remote, and whether it changed anything
 */
async function sync(options: SyncOptions): Promise<SyncResult> {
  logBetaWarning("tailordb migration");

  const targetVersion = parseMigrationNumberArg(options.number);

  const loaded = await loadConfig(options.configPath);
  const { config } = loaded;
  const configDir = path.dirname(config.path);
  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);
  const target = selectTargetNamespace(namespacesWithMigrations, options.namespace);

  assertValidMigrationFiles(target.migrationsDir, target.namespace, config.path);

  const latest = assertMigrationNumberExists(target.migrationsDir, targetVersion);

  const snapshot = reconstructSnapshotFromMigrations(target.migrationsDir, targetVersion);
  if (!snapshot) {
    throw CLIError({
      code: "MIGRATION_BASELINE_NOT_FOUND",
      message: `No initial schema snapshot found in ${target.migrationsDir}. Expected 0000/schema.json.`,
      suggestion: "Create the initial schema snapshot first.",
    });
  }

  const manifestOptions = await assertMigrationsReproduceLocalTypes(loaded, target);

  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options.profile,
    workspaceId: options.workspaceId,
  });

  const trn = resourceTrn(workspaceId, "tailordb", target.namespace);
  const currentState = await fetchRemoteMigrationState(client, trn);
  assertNoMigrationInProgress(
    currentState,
    target.namespace,
    migrationCommandContext({
      configPath: options.configPath,
      workspaceId,
      profile: options.profile,
    }),
  );
  const historyId = snapshot.rebaseline?.historyId;
  const historyOverwrite = assertLocalMigrationHistory({
    state: currentState,
    localHistoryId: historyId ?? null,
    namespace: target.namespace,
    code: "MIGRATION_SYNC_HISTORY_MISMATCH",
    force: options.force,
  });
  const current = currentState.number;
  const plan = await planSnapshotApply({
    client,
    workspaceId,
    namespace: target.namespace,
    snapshot,
  });
  const { creates, updates, deletes, desiredGqlPermissions, gqlPermissionDeletes } = plan;

  logger.newline();
  logger.info(`Namespace: ${styles.bold(target.namespace)}`);
  logger.log(
    `  Current migration: ${current === null ? "<unset>" : styles.bold(formatMigrationNumber(current))}`,
  );
  logger.log(`  Target migration: ${styles.bold(formatMigrationNumber(targetVersion))}`);
  logger.log(`  Tables to create: ${styles.bold(String(creates.length))}`);
  logger.log(`  Tables to update: ${styles.bold(String(updates.length))}`);
  logger.log(`  Tables to delete: ${styles.bold(String(deletes.length))}`);
  logger.log(`  GQL permissions to set: ${styles.bold(String(desiredGqlPermissions.length))}`);
  logger.log(`  GQL permissions to delete: ${styles.bold(String(gqlPermissionDeletes.length))}`);
  logger.newline();

  if (historyOverwrite) {
    logger.warn(historyOverwrite);
    logger.newline();
  }

  const totalOps =
    creates.length +
    updates.length +
    deletes.length +
    desiredGqlPermissions.length +
    gqlPermissionDeletes.length;
  if (totalOps === 0) {
    // Reachable only when both snapshot and remote hold no tables; the label
    // may still be stale, so the sync proceeds to update it.
    logger.info("No tables to apply; only the migration label will be updated.");
  } else {
    logger.warn(
      "This operation will overwrite remote TailorDB tables to match the selected snapshot.",
    );
    if (deletes.length > 0) {
      logger.warn("Existing data in deleted tables will be lost.");
    }
    logger.newline();
  }

  logger.warn(
    "Sync never runs migrate.ts scripts; it only applies the schema snapshot and moves the migration label.",
  );
  logger.newline();

  if (current !== null && targetVersion < current) {
    logger.warn(
      `Migrations ${formatMigrationNumber(targetVersion + 1)}–${formatMigrationNumber(
        current,
      )} will become pending again and re-execute on the next deploy, including their migrate.ts scripts. Make sure those scripts are idempotent (safe to re-run).`,
    );
    logger.newline();
  } else if (current !== null && targetVersion > current) {
    logger.warn(
      `Moving the migration label forwards (${formatMigrationNumber(current)} → ${formatMigrationNumber(
        targetVersion,
      )}): migrate.ts scripts for migrations ${formatMigrationNumber(current + 1)}–${formatMigrationNumber(
        targetVersion,
      )} will not run on the next deploy.`,
    );
    logger.newline();
  }

  if (!options.yes) {
    const confirmation = await prompt.confirm({
      message: `Continue and set migration label to ${formatMigrationNumber(targetVersion)}?`,
      default: false,
    });
    if (!confirmation) {
      throw CLIError({ code: "MIGRATION_SYNC_CANCELLED", message: "Migration sync cancelled." });
    }
    logger.newline();
  }

  try {
    await applySnapshotPlan({
      client,
      workspaceId,
      namespace: target.namespace,
      snapshot,
      manifestOptions,
      plan,
    });
  } catch (error) {
    handleOptionalToRequiredError(error, [
      "The target snapshot marks a field as required, but existing remote records have no value for it.",
      "Populate those records first (e.g. with a migration script applied via 'tailor deploy'), then re-run the sync.",
    ]);
  }

  const labelChanged = await updateMigrationLabel(
    client,
    workspaceId,
    target.namespace,
    targetVersion,
    historyId,
  );

  logger.success(
    `Synced namespace ${styles.bold(target.namespace)} to migration ${styles.bold(formatMigrationNumber(targetVersion))}.`,
  );

  if (targetVersion < latest) {
    logger.newline();
    logger.info(
      `Run 'tailor deploy' to apply migrations ${formatMigrationNumber(
        targetVersion + 1,
      )}–${formatMigrationNumber(latest)} from the working tree.`,
    );
  }
  return {
    changed: totalOps > 0 || labelChanged,
    workspaceId,
    namespace: target.namespace,
    previousMigrationNumber: current,
    migrationNumber: targetVersion,
    historyId: historyId ?? null,
    tables: { created: creates, updated: updates, deleted: deletes },
    gqlPermissions: {
      set: desiredGqlPermissions.map(({ typeName }) => typeName),
      deleted: gqlPermissionDeletes.map(({ typeName }) => typeName),
    },
  };
}

export const syncCommand = defineAppCommand({
  name: "sync",
  description:
    "Sync remote TailorDB schema and checkpoint to a local migration snapshot to recover from schema drift or a checkpoint outside the local history.",
  notes: `The command refuses to run when the namespace records a migration history ID other than the local one, or one that cannot be read, unless the namespace has neither a checkpoint nor a history ID yet. \`--force\` overwrites the tables and that history ID with those of the local history, and still asks for confirmation unless \`--yes\` is given.`,
  args: z.strictObject({
    ...deploymentArgs,
    ...confirmationArgs,
    number: arg(z.string(), {
      positional: true,
      description: "Migration number to sync to (e.g., 0001 or 1; 0 targets the baseline snapshot)",
    }),
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Target TailorDB namespace (required if multiple namespaces exist)",
    }),
    force: arg(z.boolean().default(false), {
      description:
        "Proceed even when the namespace records a migration history ID other than the local one",
    }),
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const synced = await sync({
      configPath: args.config,
      number: args.number,
      namespace: args.namespace,
      yes: args.yes,
      force: args.force,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
    printMutationResult(synced);
  },
});
