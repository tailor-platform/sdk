/**
 * Migration configuration utilities
 */

import * as path from "pathe";
import { CLIError } from "#/cli/shared/errors";
import { assertDefined } from "#/utils/assert";
import type { AppConfig } from "#/configure/config/types";

// ============================================================================
// Types
// ============================================================================

/**
 * Namespace with migrations configuration
 */
export interface NamespaceWithMigrations {
  namespace: string;
  migrationsDir: string;
}

// ============================================================================
// Config Helpers
// ============================================================================

function hasMigrationConfig(dbConfig: unknown): dbConfig is { migration: { directory: string } } {
  if (typeof dbConfig !== "object" || dbConfig === null) return false;
  if (!("migration" in dbConfig)) return false;

  const migration = dbConfig.migration;
  if (typeof migration !== "object" || migration === null) return false;
  if (!("directory" in migration)) return false;

  return typeof migration.directory === "string";
}

/**
 * Get namespaces that have migrations configured
 * @param {AppConfig} config - Application configuration
 * @param {string} configDir - Configuration directory path
 * @returns {NamespaceWithMigrations[]} Array of namespaces with migrations configured
 */
export function getNamespacesWithMigrations(
  config: AppConfig,
  configDir: string,
): NamespaceWithMigrations[] {
  const result: NamespaceWithMigrations[] = [];

  for (const namespace of Object.keys(config.db ?? {})) {
    const dbConfig = config.db?.[namespace];
    if (!hasMigrationConfig(dbConfig)) continue;

    const migrationsDir = path.resolve(configDir, dbConfig.migration.directory);
    result.push({ namespace, migrationsDir });
  }

  return result;
}

/**
 * Select the single target namespace for a migration command
 * @param {NamespaceWithMigrations[]} namespacesWithMigrations - Namespaces with migrations configured
 * @param {string | undefined} requested - Namespace requested via --namespace, if any
 * @returns {NamespaceWithMigrations} The selected namespace
 */
export function selectTargetNamespace(
  namespacesWithMigrations: NamespaceWithMigrations[],
  requested: string | undefined,
): NamespaceWithMigrations {
  if (namespacesWithMigrations.length === 0) {
    throw migrationConfigNotFoundError();
  }
  if (requested) {
    const found = namespacesWithMigrations.find((ns) => ns.namespace === requested);
    if (!found) {
      throw CLIError({
        code: "TAILORDB_NAMESPACE_NOT_FOUND",
        message: `Namespace "${requested}" not found or does not have migrations configured`,
      });
    }
    return found;
  }
  if (namespacesWithMigrations.length > 1) {
    throw CLIError({
      code: "MIGRATION_NAMESPACE_REQUIRED",
      message: `Multiple TailorDB services found. Please specify namespace with --namespace flag: ${namespacesWithMigrations
        .map((ns) => ns.namespace)
        .join(", ")}`,
    });
  }
  return assertDefined(namespacesWithMigrations[0], "namespace with migrations missing");
}

/**
 * Build the failure for a config without any TailorDB migration settings.
 * @returns CLIError pointing at the migration configuration
 */
export function migrationConfigNotFoundError(): CLIError {
  return CLIError({
    code: "MIGRATION_CONFIG_NOT_FOUND",
    message: "No TailorDB services with migrations configuration found",
    suggestion: "Configure `migration` on the TailorDB service in tailor.config.ts.",
  });
}
