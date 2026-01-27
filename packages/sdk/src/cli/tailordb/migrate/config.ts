/**
 * Migration configuration utilities
 */

import * as path from "pathe";
import type { AppConfig } from "@/parser/app-config";

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
