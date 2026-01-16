/**
 * Migration execution service for TailorDB migrations
 *
 * Handles detection and execution of pending migration scripts via TestExecScript API.
 */

import * as fs from "node:fs";
import { create } from "@bufbuild/protobuf";
import { AuthInvokerSchema } from "@tailor-proto/tailor/v1/auth_resource_pb";
import { FunctionExecution_Status } from "@tailor-proto/tailor/v1/function_resource_pb";
import ora from "ora";
import { bundleMigrationScript } from "../../bundler/migration/migration-bundler";
import { type OperatorClient } from "../../client";
import { loadDiff, getMigrationFiles } from "../../tailordb/migrate/snapshot";
import {
  type PendingMigration,
  type NamespaceWithMigrations,
  MIGRATION_LABEL_KEY,
  MIGRATION_POLL_INTERVAL,
  formatMigrationNumber,
  parseMigrationLabelNumber,
  getMigrationFilePath,
} from "../../tailordb/migrate/types";
import { logger, styles } from "../../utils/logger";
import { trnPrefix } from "./label";

// ============================================================================
// Types
// ============================================================================

export interface MigrationExecutionOptions {
  client: OperatorClient;
  workspaceId: string;
  authNamespace: string;
  machineUserName: string;
  generatedTailorDBPath: string;
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

  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    // Get current applied migration number
    const currentMigration = await getCurrentMigrationNumber(client, workspaceId, namespace);

    // Get all migration files
    const migrationFiles = getMigrationFiles(migrationsDir);

    // Find migration scripts that haven't been applied yet
    for (const file of migrationFiles) {
      if (file.number <= currentMigration) {
        continue;
      }

      // Check if there's a migration script for this number (directory structure)
      const scriptPath = getMigrationFilePath(migrationsDir, file.number, "migrate");
      const diffPath = getMigrationFilePath(migrationsDir, file.number, "diff");

      if (!fs.existsSync(scriptPath)) {
        continue;
      }

      if (!fs.existsSync(diffPath)) {
        continue;
      }

      // Load the diff to include in pending migration
      const diff = loadDiff(diffPath);

      pendingMigrations.push({
        number: file.number,
        scriptPath,
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
 * Wait for a function execution to complete
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {string} executionId - Execution ID to wait for
 * @returns {Promise<{ status: FunctionExecution_Status; logs: string; result: string }>} Execution result
 */
async function waitForExecution(
  client: OperatorClient,
  workspaceId: string,
  executionId: string,
): Promise<{ status: FunctionExecution_Status; logs: string; result: string }> {
  while (true) {
    const { execution } = await client.getFunctionExecution({
      workspaceId,
      executionId,
    });

    if (!execution) {
      throw new Error(`Execution '${executionId}' not found.`);
    }

    // Check for terminal states
    if (
      execution.status === FunctionExecution_Status.SUCCESS ||
      execution.status === FunctionExecution_Status.FAILED
    ) {
      return {
        status: execution.status,
        logs: execution.logs,
        result: execution.result,
      };
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, MIGRATION_POLL_INTERVAL));
  }
}

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
  const { client, workspaceId, authNamespace, machineUserName, generatedTailorDBPath } = options;

  const migrationName = `migration-${migration.namespace}-${formatMigrationNumber(migration.number)}.js`;

  // Bundle the migration script
  const bundleResult = await bundleMigrationScript(
    migration.scriptPath,
    migration.namespace,
    migration.number,
    generatedTailorDBPath,
  );

  // Create auth invoker
  const authInvoker = create(AuthInvokerSchema, {
    namespace: authNamespace,
    machineUserName,
  });

  // Execute the script
  const { executionId } = await client.testExecScript({
    workspaceId,
    name: migrationName,
    code: bundleResult.bundledCode,
    arg: JSON.stringify({}),
    invoker: authInvoker,
  });

  // Wait for completion
  const result = await waitForExecution(client, workspaceId, executionId);

  if (result.status === FunctionExecution_Status.SUCCESS) {
    return {
      namespace: migration.namespace,
      migrationNumber: migration.number,
      success: true,
      logs: result.logs,
    };
  } else {
    return {
      namespace: migration.namespace,
      migrationNumber: migration.number,
      success: false,
      logs: result.logs,
      error: `Migration failed: ${result.logs}`,
    };
  }
}

/**
 * Update the migration label on TailorDB Service metadata
 * @param {OperatorClient} client - Operator client instance
 * @param {string} workspaceId - Workspace ID
 * @param {string} namespace - TailorDB namespace
 * @param {number} migrationNumber - Migration number to set
 * @returns {Promise<void>}
 */
async function updateMigrationLabel(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
  migrationNumber: number,
): Promise<void> {
  const trn = `${trnPrefix(workspaceId)}:tailordb:${namespace}`;

  // Get existing metadata
  const { metadata } = await client.getMetadata({ trn });
  const existingLabels = metadata?.labels ?? {};

  // Update with new migration label
  await client.setMetadata({
    trn,
    labels: {
      ...existingLabels,
      [MIGRATION_LABEL_KEY]: `m${formatMigrationNumber(migrationNumber)}`,
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
  if (migrations.length === 0) {
    return;
  }

  logger.info(`Executing ${migrations.length} pending migration(s)...`);
  logger.info(`Using machine user: ${styles.bold(options.machineUserName)}`);
  logger.newline();

  for (const migration of migrations) {
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
        logger.debug(`Logs:\n${result.logs}`);
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
  logger.success(`All migrations completed successfully.`);
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
