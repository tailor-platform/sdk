/**
 * Types for TailorDB migration functionality
 */

import * as path from "node:path";
import type { AppConfig } from "@/configure/config";

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum length for Kubernetes label values
 * Labels must match pattern: ^[a-z][a-z0-9_-]{0,62}
 */
export const MAX_LABEL_LENGTH = 63;

/**
 * Default migration execution timeout in milliseconds (10 minutes)
 */
export const DEFAULT_MIGRATION_TIMEOUT = 10 * 60 * 1000;

/**
 * Default polling interval for migration execution status in milliseconds (1 second)
 */
export const MIGRATION_POLL_INTERVAL = 1000;

/**
 * Prefix added to migration numbers in labels (required because migration names start with numbers)
 */
export const MIGRATION_LABEL_PREFIX = "m";

/**
 * Pattern for validating migration number format (4-digit sequential number)
 * Examples: 0001, 0002, 0003, ...
 */
export const MIGRATION_NUMBER_PATTERN = /^\d{4}$/;

/**
 * Migration file names (used within migration directories)
 */
export const SCHEMA_FILE_NAME = "schema.json";
export const DIFF_FILE_NAME = "diff.json";
export const MIGRATE_FILE_NAME = "migrate.ts";
export const DB_TYPES_FILE_NAME = "db.ts";

/**
 * Initial schema migration number (0000)
 */
export const INITIAL_SCHEMA_NUMBER = 0;

/**
 * Current schema snapshot format version
 */
export const SCHEMA_SNAPSHOT_VERSION = 1 as const;

/**
 * Error patterns that indicate schema corruption
 */
export const SCHEMA_ERROR_PATTERNS = [
  "failed to fetch schema",
  "sqlaccess error",
  "schema not found",
  "invalid schema",
] as const;

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
    if (!dbConfig) continue;

    if (
      typeof dbConfig !== "object" ||
      !("migration" in dbConfig) ||
      typeof dbConfig.migration !== "object" ||
      dbConfig.migration === null ||
      !("directory" in dbConfig.migration) ||
      typeof dbConfig.migration.directory !== "string"
    ) {
      continue;
    }

    const migrationsDir = path.resolve(configDir, dbConfig.migration.directory);
    result.push({ namespace, migrationsDir });
  }

  return result;
}

// ============================================================================
// Schema Snapshot Types
// ============================================================================

/**
 * Field configuration in schema snapshot
 */
export interface SnapshotFieldConfig {
  type: string;
  required: boolean;
  array?: boolean;
  index?: boolean;
  unique?: boolean;
  allowedValues?: string[];
  foreignKey?: boolean;
  foreignKeyType?: string;
  foreignKeyField?: string;
}

/**
 * Type definition in schema snapshot
 */
export interface SnapshotType {
  name: string;
  pluralForm?: string;
  description?: string;
  fields: Record<string, SnapshotFieldConfig>;
  settings?: {
    aggregation?: boolean;
    bulkUpsert?: boolean;
  };
}

/**
 * Schema snapshot - full schema state at a point in time
 * Stored as XXXX/schema.json (e.g., 0000/schema.json for initial snapshot)
 */
export interface SchemaSnapshot {
  /** Format version for future compatibility */
  version: typeof SCHEMA_SNAPSHOT_VERSION;
  namespace: string;
  createdAt: string;
  types: Record<string, SnapshotType>;
}

// ============================================================================
// Migration Diff Types
// ============================================================================

/**
 * Change kind in migration diff
 */
export type DiffChangeKind =
  | "type_added"
  | "type_removed"
  | "field_added"
  | "field_removed"
  | "field_modified";

/**
 * Single change in migration diff
 */
export interface DiffChange {
  kind: DiffChangeKind;
  typeName: string;
  fieldName?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Migration diff - changes between two schema versions
 * Stored as XXXX/diff.json (e.g., 0001/diff.json)
 */
export interface MigrationDiff {
  /** Format version for future compatibility */
  version: typeof SCHEMA_SNAPSHOT_VERSION;
  namespace: string;
  createdAt: string;
  description?: string;
  changes: DiffChange[];
  /** Whether there are breaking changes (data loss or constraint violations possible) */
  hasBreakingChanges: boolean;
  /** List of breaking changes */
  breakingChanges: BreakingChangeInfo[];
  /** Whether a migration script is required to handle data migration */
  requiresMigrationScript: boolean;
}

/**
 * Breaking change information in migration diff
 */
export interface BreakingChangeInfo {
  typeName: string;
  fieldName?: string;
  reason: string;
}

// ============================================================================
// Migration State Types
// ============================================================================

/**
 * Label key for storing migration state in TailorDB Service metadata
 */
export const MIGRATION_LABEL_KEY = "sdk-migration";

/**
 * Migration file type
 */
export type MigrationFileType = "schema" | "diff" | "migrate" | "db";

/**
 * Information about a migration
 */
export interface MigrationInfo {
  /** Migration number (e.g., 1, 2, 3) */
  number: number;
  /** Migration number as 4-digit string (e.g., "0001", "0002") */
  numberStr: string;
  /** Migration file type */
  type: MigrationFileType;
  /** Path to migration file */
  path: string;
  /** Parsed content (schema snapshot or diff) */
  content: SchemaSnapshot | MigrationDiff;
}

/**
 * Pending migration to be executed
 */
export interface PendingMigration {
  /** Migration number */
  number: number;
  /** Path to migration script file */
  scriptPath: string;
  /** Path to diff file */
  diffPath: string;
  /** Namespace this migration belongs to */
  namespace: string;
  /** Migrations directory path */
  migrationsDir: string;
  /** Migration diff content */
  diff: MigrationDiff;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate that a migration number follows the expected format (4-digit number)
 * @param {string} numberStr - Migration number string to validate
 * @returns {boolean} True if number matches expected format
 */
export function isValidMigrationNumber(numberStr: string): boolean {
  return MIGRATION_NUMBER_PATTERN.test(numberStr);
}

/**
 * Format migration number as 4-digit string
 * @param {number} num - Migration number
 * @returns {string} 4-digit padded string (e.g., "0001")
 */
export function formatMigrationNumber(num: number): string {
  return num.toString().padStart(4, "0");
}

/**
 * Parse migration number from file name
 * @param {string} fileName - File name (e.g., "0001_schema.json")
 * @returns {number | null} Parsed number or null if invalid
 */
export function parseMigrationNumber(fileName: string): number | null {
  const match = fileName.match(/^(\d{4})_/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  return isNaN(num) ? null : num;
}

/**
 * Sanitize migration number for use as label value
 * Label pattern: ^[a-z][a-z0-9_-]{0,62}
 * - Must start with lowercase letter (add prefix since migration numbers start with digits)
 * - Max 63 characters
 * @param {number} migrationNumber - Migration number to sanitize
 * @returns {string} Sanitized label value
 */
export function sanitizeMigrationLabel(migrationNumber: number): string {
  const sanitized = MIGRATION_LABEL_PREFIX + formatMigrationNumber(migrationNumber);
  return sanitized.slice(0, MAX_LABEL_LENGTH);
}

/**
 * Parse migration number from label value
 * @param {string} label - Label value (e.g., "m0001")
 * @returns {number | null} Parsed number or null if invalid
 */
export function parseMigrationLabelNumber(label: string): number | null {
  if (!label.startsWith(MIGRATION_LABEL_PREFIX)) return null;
  const numStr = label.slice(MIGRATION_LABEL_PREFIX.length);
  const num = parseInt(numStr, 10);
  return isNaN(num) ? null : num;
}

/**
 * Check if an error message indicates schema corruption
 * @param {string} errorMessage - Error message to check
 * @returns {boolean} True if error indicates schema corruption
 */
export function isSchemaError(errorMessage: string): boolean {
  const lowerMessage = errorMessage.toLowerCase();
  return SCHEMA_ERROR_PATTERNS.some((pattern) => lowerMessage.includes(pattern));
}

/**
 * Get migration directory path for a given number
 * @param {string} migrationsDir - Base migrations directory path
 * @param {number} num - Migration number
 * @returns {string} Full directory path for the migration
 */
export function getMigrationDirPath(migrationsDir: string, num: number): string {
  const numStr = formatMigrationNumber(num);
  return path.join(migrationsDir, numStr);
}

/**
 * Map of migration file types to their file names
 */
const MIGRATION_FILE_NAMES: Record<MigrationFileType, string> = {
  schema: SCHEMA_FILE_NAME,
  diff: DIFF_FILE_NAME,
  migrate: MIGRATE_FILE_NAME,
  db: DB_TYPES_FILE_NAME,
};

/**
 * Get migration file path for a given number and type
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} num - Migration number
 * @param {MigrationFileType} type - File type
 * @returns {string} Full file path
 */
export function getMigrationFilePath(
  migrationsDir: string,
  num: number,
  type: MigrationFileType,
): string {
  const migrationDir = getMigrationDirPath(migrationsDir, num);
  return path.join(migrationDir, MIGRATION_FILE_NAMES[type]);
}
