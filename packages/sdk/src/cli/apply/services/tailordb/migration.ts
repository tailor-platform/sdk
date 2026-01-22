/**
 * Migration execution service for TailorDB migrations
 *
 * Handles detection and execution of pending migration scripts via TestExecScript API.
 */

import * as fs from "node:fs";
import ora from "ora";
import * as path from "pathe";
import { bundleMigrationScript } from "../../../bundler/migration/migration-bundler";
import { type OperatorClient } from "../../../client";
import {
  getNamespacesWithMigrations,
  type NamespaceWithMigrations,
} from "../../../tailordb/migrate/config";
import {
  loadDiff,
  getMigrationFiles,
  reconstructSnapshotFromMigrations,
  filterTypeToSnapshot,
  getMigrationFilePath,
  formatMigrationNumber,
} from "../../../tailordb/migrate/snapshot";
import {
  type PendingMigration,
  MIGRATION_LABEL_KEY,
  parseMigrationLabelNumber,
} from "../../../tailordb/migrate/types";
import { logger, styles } from "../../../utils/logger";
import { executeScript } from "../../../utils/script-executor";
import { trnPrefix } from "../label";
import type { Application } from "@/cli/application";
import type { LoadedConfig } from "@/cli/config-loader";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";
import type { AuthInvoker } from "@tailor-proto/tailor/v1/auth_resource_pb";

// ============================================================================
// Types
// ============================================================================

export interface MigrationExecutionOptions {
  client: OperatorClient;
  workspaceId: string;
  authInvoker: AuthInvoker;
}

interface ExecutionResult {
  namespace: string;
  migrationNumber: number;
  success: boolean;
  logs?: string;
  error?: string;
}

// ============================================================================
// Migration Detection
// ============================================================================

/**
 * Get the current migration label from TailorDB Service metadata
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {string} namespace - TailorDB namespace
 * @returns {Promise<number>} Current migration number (0 if none)
 */
async function getCurrentMigrationNumber(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
): Promise<number> {
  try {
    const trn = `${trnPrefix(workspaceId)}:tailordb:${namespace}`;

    const { metadata } = await client.getMetadata({ trn });

    const label = metadata?.labels[MIGRATION_LABEL_KEY];

    if (!label) {
      return 0;
    }
    const num = parseMigrationLabelNumber(label);
    return num ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Detect pending migrations that need to be executed
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {NamespaceWithMigrations[]} namespacesWithMigrations - Namespaces with migrations config
 * @returns {Promise<PendingMigration[]>} List of pending migrations
 */
export async function detectPendingMigrations(
  client: OperatorClient,
  workspaceId: string,
  namespacesWithMigrations: NamespaceWithMigrations[],
): Promise<PendingMigration[]> {
  const pendingMigrations: PendingMigration[] = [];

  // Check for max version from environment variable
  const maxVersionEnv = process.env.TAILOR_INTERNAL_APPLY_MIGRATION_VERSION;
  const maxVersion = maxVersionEnv ? parseInt(maxVersionEnv, 10) : undefined;

  if (maxVersion !== undefined && !Number.isInteger(maxVersion)) {
    throw new Error(
      `Invalid TAILOR_INTERNAL_APPLY_MIGRATION_VERSION: "${maxVersionEnv}". Must be a valid integer.`,
    );
  }

  if (maxVersion !== undefined) {
    logger.newline();
    logger.info(
      `Limiting migrations to version ${styles.bold(formatMigrationNumber(maxVersion))} or earlier`,
    );
  }

  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    // Get current applied migration number
    const currentMigration = await getCurrentMigrationNumber(client, workspaceId, namespace);

    // Get all migration files
    const migrationFiles = getMigrationFiles(migrationsDir);

    // Find migrations that haven't been applied yet
    for (const file of migrationFiles) {
      if (file.number <= currentMigration) {
        continue;
      }

      // Skip migrations beyond max version if specified
      if (maxVersion !== undefined && file.number > maxVersion) {
        continue;
      }

      // Check for diff file (all migrations must have a diff)
      const diffPath = getMigrationFilePath(migrationsDir, file.number, "diff");
      if (!fs.existsSync(diffPath)) {
        continue;
      }

      // Load the diff to check if migration script is required
      const diff = loadDiff(diffPath);

      // Check for migration script (only required for breaking changes)
      const scriptPath = getMigrationFilePath(migrationsDir, file.number, "migrate");
      if (diff.requiresMigrationScript && !fs.existsSync(scriptPath)) {
        logger.warn(
          `Migration ${namespace}/${file.number} requires a script but migrate.ts not found`,
        );
        continue;
      }

      pendingMigrations.push({
        number: file.number,
        scriptPath, // May not exist for non-breaking changes
        diffPath,
        namespace,
        migrationsDir,
        diff,
      });
    }
  }

  // Sort by namespace and migration number
  pendingMigrations.sort((a, b) => {
    if (a.namespace !== b.namespace) {
      return a.namespace.localeCompare(b.namespace);
    }
    return a.number - b.number;
  });

  return pendingMigrations;
}

// ============================================================================
// Migration Execution
// ============================================================================

/**
 * Execute a single migration script
 * @param {MigrationExecutionOptions} options - Execution options
 * @param {PendingMigration} migration - Migration to execute
 * @returns {Promise<ExecutionResult>} Execution result
 */
async function executeSingleMigration(
  options: MigrationExecutionOptions,
  migration: PendingMigration,
): Promise<ExecutionResult> {
  const { client, workspaceId, authInvoker } = options;

  const migrationName = `migration-${migration.namespace}-${formatMigrationNumber(migration.number)}.js`;

  // Bundle the migration script
  const bundleResult = await bundleMigrationScript(
    migration.scriptPath,
    migration.namespace,
    migration.number,
  );

  // Execute the script using the shared script executor
  const result = await executeScript({
    client,
    workspaceId,
    name: migrationName,
    code: bundleResult.bundledCode,
    invoker: authInvoker,
  });

  return {
    namespace: migration.namespace,
    migrationNumber: migration.number,
    success: result.success,
    logs: result.logs,
    error: result.error,
  };
}

/**
 * Update the migration label on TailorDB Service metadata
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {string} namespace - TailorDB namespace
 * @param {number} migrationNumber - Migration number to set
 * @returns {Promise<void>}
 */
export async function updateMigrationLabel(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
  migrationNumber: number,
): Promise<void> {
  const trn = `${trnPrefix(workspaceId)}:tailordb:${namespace}`;

  // Get existing metadata
  const { metadata } = await client.getMetadata({ trn });
  const existingLabels = metadata?.labels ?? {};

  const newLabel = `m${formatMigrationNumber(migrationNumber)}`;

  // Update with new migration label
  await client.setMetadata({
    trn,
    labels: {
      ...existingLabels,
      [MIGRATION_LABEL_KEY]: newLabel,
    },
  });
}

/**
 * Execute all pending migrations
 * @param {MigrationExecutionOptions} options - Execution options
 * @param {PendingMigration[]} migrations - Migrations to execute
 * @returns {Promise<void>}
 */
export async function executeMigrations(
  options: MigrationExecutionOptions,
  migrations: PendingMigration[],
): Promise<void> {
  // Filter migrations that require script execution
  const migrationsWithScripts = migrations.filter((m) => m.diff.requiresMigrationScript);

  if (migrationsWithScripts.length === 0) {
    return;
  }

  logger.info(`Executing ${migrationsWithScripts.length} data migration(s)...`);
  logger.info(`Using machine user: ${styles.bold(options.authInvoker.machineUserName)}`);
  logger.newline();

  for (const migration of migrationsWithScripts) {
    const migrationLabel = `${migration.namespace}/${formatMigrationNumber(migration.number)}`;
    const spinner = ora({
      text: `Executing migration ${migrationLabel}...`,
      prefixText: "",
    }).start();

    const result = await executeSingleMigration(options, migration);

    if (result.success) {
      // Update the migration label
      await updateMigrationLabel(
        options.client,
        options.workspaceId,
        migration.namespace,
        migration.number,
      );

      spinner.succeed(`Migration ${migrationLabel} completed successfully`);

      // Show logs if any
      if (result.logs && result.logs.trim()) {
        logger.log(`Logs:\n${result.logs}`);
      }
    } else {
      spinner.fail(`Migration ${migrationLabel} failed`);
      if (result.logs) {
        logger.error(`Logs:\n${result.logs}`);
      }
      throw new Error(result.error ?? "Migration failed");
    }
  }

  logger.newline();
  logger.success(`All data migrations completed successfully.`);
}

/**
 * Get the machine user name for migration execution
 *
 * Priority:
 * 1. machineUser from migration config (if set)
 * 2. First machine user from auth config
 * @param {object | undefined} migrationConfig - Migration config for namespace
 * @param {string[] | undefined} machineUsers - Machine users from auth config
 * @returns {string | undefined} Machine user name or undefined if none available
 */
export function getMigrationMachineUser(
  migrationConfig: { machineUser?: string } | undefined,
  machineUsers: string[] | undefined,
): string | undefined {
  // Priority 1: Explicit config
  if (migrationConfig?.machineUser) {
    return migrationConfig.machineUser;
  }

  // Priority 2: First machine user from auth
  if (machineUsers && machineUsers.length > 0) {
    return machineUsers[0];
  }

  return undefined;
}

// ============================================================================
// Migration Version Control
// ============================================================================

/**
 * Build filtered types map for a specific migration version
 * @param {number} maxVersion - Maximum migration version to reconstruct
 * @param {Application} application - Application instance
 * @param {LoadedConfig} config - Loaded application config (includes path)
 * @returns {Promise<Map<string, Record<string, ParsedTailorDBType>>>} Filtered types by namespace
 */
export async function buildFilteredTypesForVersion(
  maxVersion: number,
  application: Readonly<Application>,
  config: LoadedConfig,
): Promise<Map<string, Record<string, ParsedTailorDBType>>> {
  const configDir = path.dirname(config.path);
  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);

  const filteredTypesByNamespace = new Map<string, Record<string, ParsedTailorDBType>>();

  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    // Reconstruct snapshot up to maxVersion
    const snapshot = reconstructSnapshotFromMigrations(migrationsDir, maxVersion);
    if (!snapshot) {
      throw new Error(`No migrations found in ${migrationsDir}`);
    }

    // Get local types for this namespace
    const tailordb = application.tailorDBServices.find((tdb) => tdb.namespace === namespace);
    if (!tailordb) {
      throw new Error(`TailorDB service not found for namespace: ${namespace}`);
    }

    await tailordb.loadTypes();
    const localTypes = tailordb.getTypes();

    // Filter local types to match snapshot state
    const filteredTypes: Record<string, ParsedTailorDBType> = {};
    for (const typeName of Object.keys(snapshot.types)) {
      const localType = localTypes[typeName];
      if (localType) {
        const snapshotType = snapshot.types[typeName];
        filteredTypes[typeName] = filterTypeToSnapshot(localType, snapshotType);
      }
    }

    filteredTypesByNamespace.set(namespace, filteredTypes);
  }

  return filteredTypesByNamespace;
}
