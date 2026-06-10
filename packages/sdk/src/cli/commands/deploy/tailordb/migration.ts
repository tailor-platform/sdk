/**
 * Migration execution service for TailorDB migrations
 *
 * Handles detection and execution of pending migration scripts via TestExecScript API.
 */

import * as fs from "node:fs";
import { create } from "@bufbuild/protobuf";
import { AuthInvokerSchema, type AuthInvoker } from "@tailor-proto/tailor/v1/auth_resource_pb";
import { bundleMigrationScript } from "@/cli/commands/tailordb/migrate/bundler";
import { type NamespaceWithMigrations } from "@/cli/commands/tailordb/migrate/config";
import {
  loadDiff,
  getMigrationFiles,
  getMigrationFilePath,
  formatMigrationNumber,
} from "@/cli/commands/tailordb/migrate/snapshot";
import {
  type PendingMigration,
  MIGRATION_LABEL_KEY,
  parseMigrationLabelNumber,
} from "@/cli/commands/tailordb/migrate/types";
import { type OperatorClient } from "@/cli/shared/client";
import { logger, styles } from "@/cli/shared/logger";
import { executeScript } from "@/cli/shared/script-executor";
import { spinner } from "@/cli/shared/spinner";
import { resourceTrn } from "../label";
import type { TailorDBServiceConfig } from "@/types/tailordb.generated";

// ============================================================================
// Types
// ============================================================================

export interface MigrationExecutionOptions {
  client: OperatorClient;
  workspaceId: string;
  authInvoker: AuthInvoker;
  env: Record<string, string | number | boolean>;
}

/**
 * Context for migration execution with per-namespace configuration
 */
export interface MigrationContext {
  client: OperatorClient;
  workspaceId: string;
  authNamespace: string;
  machineUsers: string[] | undefined;
  dbConfig: Record<string, TailorDBServiceConfig | undefined>;
  env: Record<string, string | number | boolean>;
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
    const trn = resourceTrn(workspaceId, "tailordb", namespace);

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

    // Find migrations that haven't been applied yet
    for (const file of migrationFiles) {
      if (file.number <= currentMigration) {
        continue;
      }

      // Check for diff file (all migrations must have a diff)
      const diffPath = getMigrationFilePath(migrationsDir, file.number, "diff");
      if (!fs.existsSync(diffPath)) {
        continue;
      }

      // Load the diff to inspect breaking/warning classification
      const diff = loadDiff(diffPath);

      // The migration script is executed when migrate.ts exists on disk.
      // Breaking changes still hard-require a script; warnings (e.g. field_removed)
      // may optionally have one added via `tailordb migration script <num>`.
      const scriptPath = getMigrationFilePath(migrationsDir, file.number, "migrate");
      const hasScript = fs.existsSync(scriptPath);
      if (diff.requiresMigrationScript && !hasScript) {
        logger.warn(
          `Migration ${namespace}/${file.number} requires a script but migrate.ts not found`,
        );
        continue;
      }

      pendingMigrations.push({
        number: file.number,
        scriptPath,
        hasScript,
        diffPath,
        namespace,
        migrationsDir,
        diff,
      });
    }
  }

  // Sort by namespace and migration number
  return pendingMigrations.toSorted((a, b) => {
    if (a.namespace !== b.namespace) {
      return a.namespace.localeCompare(b.namespace);
    }
    return a.number - b.number;
  });
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
  const { client, workspaceId, authInvoker, env } = options;

  const migrationName = `migration-${migration.namespace}-${formatMigrationNumber(migration.number)}.js`;

  // Bundle the migration script
  const bundleResult = await bundleMigrationScript(
    migration.scriptPath,
    migration.namespace,
    migration.number,
    env,
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
  const trn = resourceTrn(workspaceId, "tailordb", namespace);

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
 * Execute all pending migrations, grouping by namespace and using appropriate machine user
 * @param {MigrationContext} context - Migration context with per-namespace configuration
 * @param {PendingMigration[]} migrations - Migrations to execute
 * @returns {Promise<void>}
 */
export async function executeMigrations(
  context: MigrationContext,
  migrations: PendingMigration[],
): Promise<void> {
  // Run migrate.ts whenever the file exists on disk. Required for breaking changes,
  // optional for warning-tier changes (e.g. field_removed).
  const migrationsWithScripts = migrations.filter((m) => m.hasScript);

  if (migrationsWithScripts.length === 0) {
    return;
  }

  // Group migrations by namespace
  const migrationsByNamespace = groupMigrationsByNamespace(migrationsWithScripts);

  // Execute migrations for each namespace with appropriate machine user
  for (const [namespace, namespaceMigrations] of migrationsByNamespace) {
    const dbConfig = context.dbConfig[namespace];
    const migrationConfig = dbConfig?.migration;

    // Get machine user name for this namespace
    const machineUserName = getMigrationMachineUser(migrationConfig, context.machineUsers);
    if (!machineUserName) {
      throw new Error(
        `No machine user available for migration execution in namespace '${namespace}'. ` +
          "Either configure 'migration.machineUser' in db config or define machine users in auth config.",
      );
    }

    // Create authInvoker for this namespace
    const authInvoker = create(AuthInvokerSchema, {
      namespace: context.authNamespace,
      machineUserName,
    });

    const options: MigrationExecutionOptions = {
      client: context.client,
      workspaceId: context.workspaceId,
      authInvoker,
      env: context.env,
    };

    logger.info(`Using machine user: ${styles.bold(machineUserName)} for namespace '${namespace}'`);

    for (const migration of namespaceMigrations) {
      const migrationLabel = `${migration.namespace}/${formatMigrationNumber(migration.number)}`;
      const sp = spinner().start(`Executing migration ${migrationLabel}...`);

      const result = await executeSingleMigration(options, migration);

      if (result.success) {
        sp.succeed(`Migration ${migrationLabel} completed successfully`);

        // Show logs if any
        if (result.logs && result.logs.trim()) {
          logger.log(`Logs:\n${result.logs}`);
        }
      } else {
        sp.fail(`Migration ${migrationLabel} failed`);
        if (result.logs) {
          logger.error(`Logs:\n${result.logs}`);
        }
        throw new Error(result.error ?? "Migration failed");
      }
    }
  }
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

/**
 * Group migrations by namespace
 * @param {PendingMigration[]} migrations - Migrations to group
 * @returns {Map<string, PendingMigration[]>} Migrations grouped by namespace
 */
export function groupMigrationsByNamespace(
  migrations: PendingMigration[],
): Map<string, PendingMigration[]> {
  const grouped = new Map<string, PendingMigration[]>();
  for (const migration of migrations) {
    const existing = grouped.get(migration.namespace) ?? [];
    existing.push(migration);
    grouped.set(migration.namespace, existing);
  }
  return grouped;
}
