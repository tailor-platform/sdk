/**
 * Migration configuration utilities
 */

import * as path from "pathe";
import { DEFAULT_CONFIG_PATH } from "#/cli/shared/args";
import { shellQuote } from "#/cli/shared/errors";
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

  const migration = (dbConfig as { migration: unknown }).migration;
  if (typeof migration !== "object" || migration === null) return false;
  if (!("directory" in migration)) return false;

  return typeof (migration as { directory: unknown }).directory === "string";
}

/**
 * Format the --config argument for remediation commands so they target the
 * same config the current run used
 * @param {string} [configPath] - Config path passed to the command, if any
 * @returns {string} Leading-space --config argument, or an empty string when the default config is in use
 */
export function formatConfigArg(configPath?: string): string {
  if (!configPath || configPath === DEFAULT_CONFIG_PATH) return "";
  return ` --config ${shellQuote(path.relative(process.cwd(), configPath) || configPath)}`;
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
    throw new Error("No TailorDB services with migrations configuration found");
  }
  if (requested) {
    const found = namespacesWithMigrations.find((ns) => ns.namespace === requested);
    if (!found) {
      throw new Error(`Namespace "${requested}" not found or does not have migrations configured`);
    }
    return found;
  }
  if (namespacesWithMigrations.length > 1) {
    throw new Error(
      `Multiple TailorDB services found. Please specify namespace with --namespace flag: ${namespacesWithMigrations
        .map((ns) => ns.namespace)
        .join(", ")}`,
    );
  }
  return assertDefined(namespacesWithMigrations[0], "namespace with migrations missing");
}
