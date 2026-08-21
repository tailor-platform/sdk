import * as fs from "node:fs";
import * as path from "pathe";
import { z } from "zod";
import { type MigrationDiff } from "./diff-calculator";
import { formatMigrationNumber } from "./migration-number";
import {
  assertSupportedMigrationFileVersion,
  normalizeLegacyChangeKinds,
  normalizeLegacyFieldNames,
  normalizeLegacyTablesKey,
  normalizeSchemaSnapshot,
} from "./snapshot-normalization";
import { schemaSnapshotSchema, migrationDiffSchema } from "./snapshot-schema";
import { type NormalizedSchemaSnapshot, type SchemaSnapshot } from "./snapshot-types";
import { deriveWarningsFromChanges } from "./snapshot-warnings";

// ============================================================================
// Constants
// ============================================================================

/**
 * Initial schema migration number (0000)
 */
export const INITIAL_SCHEMA_NUMBER = 0;

/**
 * Migration file names (used within migration directories)
 */
export const SCHEMA_FILE_NAME = "schema.json";
/** File name for migration diff metadata. */
export const DIFF_FILE_NAME = "diff.json";
/** File name for migration script. */
export const MIGRATE_FILE_NAME = "migrate.ts";
/** File name for migration script unit test. */
export const MIGRATE_TEST_FILE_NAME = "migrate.test.ts";
/** File name for generated DB type definitions. */
export const DB_TYPES_FILE_NAME = "db.ts";

/**
 * Pattern for validating migration number format (4-digit sequential number)
 * Examples: 0001, 0002, 0003, ...
 */
export const MIGRATION_NUMBER_PATTERN = /^\d{4}$/;

/** Highest migration number the four-digit directory name can hold. */
export const MAX_MIGRATION_NUMBER = 9999;

/**
 * Migration file type
 */
export type MigrationFileType = "schema" | "diff" | "migrate" | "test" | "db";

// ============================================================================
// Migration Number Helpers
// ============================================================================

/**
 * Validate that a migration number follows the expected format (4-digit number)
 * @param {string} numberStr - Migration number string to validate
 * @returns {boolean} True if number matches expected format
 */
export function isValidMigrationNumber(numberStr: string): boolean {
  return MIGRATION_NUMBER_PATTERN.test(numberStr);
}

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Map of migration file types to their file names
 */
export const MIGRATION_FILE_NAMES: Record<MigrationFileType, string> = {
  schema: SCHEMA_FILE_NAME,
  diff: DIFF_FILE_NAME,
  migrate: MIGRATE_FILE_NAME,
  test: MIGRATE_TEST_FILE_NAME,
  db: DB_TYPES_FILE_NAME,
};

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

// ============================================================================
// Snapshot Loading
// ============================================================================

/**
 * Load a schema snapshot from a file
 * @param {string} filePath - Path to the snapshot file
 * @returns {NormalizedSchemaSnapshot} Loaded normalized schema snapshot
 */
export function loadSnapshot(filePath: string): NormalizedSchemaSnapshot {
  const content = fs.readFileSync(filePath, "utf-8");
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid schema snapshot at ${filePath}: ${String(error)}`, { cause: error });
  }
  assertSupportedMigrationFileVersion(filePath, raw);
  const result = schemaSnapshotSchema.safeParse(normalizeLegacyTablesKey(raw));
  if (!result.success) {
    throw new Error(`Invalid schema snapshot at ${filePath}: ${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  const snapshot = result.data;
  return normalizeSchemaSnapshot(snapshot);
}

/**
 * Load a migration diff from a file
 * @param {string} filePath - Path to the diff file
 * @returns {MigrationDiff} Loaded migration diff
 */
export function loadDiff(filePath: string): MigrationDiff {
  const content = fs.readFileSync(filePath, "utf-8");
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid migration diff at ${filePath}: ${String(error)}`, { cause: error });
  }
  assertSupportedMigrationFileVersion(filePath, raw);
  const result = migrationDiffSchema.safeParse(
    normalizeLegacyFieldNames(normalizeLegacyChangeKinds(raw)),
  );
  if (!result.success) {
    throw new Error(`Invalid migration diff at ${filePath}: ${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  const parsed = result.data;
  // Backfill fields introduced after the initial diff.json schema so that older
  // migrations on disk remain readable without manual edits. A missing warnings
  // field (pre-warning-tier diff.json) is reconstructed from the recorded
  // removal changes so those migrations keep their data-loss classification.
  // hasWarnings is derived from the warnings array to stay consistent even if
  // a hand-edited diff.json sets one side without the other.
  // `warnings` is optional in the schema (backcompat) but cast to required; guard for safety
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  const warnings = parsed.warnings ?? deriveWarningsFromChanges(parsed);
  return {
    ...parsed,
    warnings,
    hasWarnings: warnings.length > 0,
  };
}

/**
 * Get all migration directories and their files, sorted by number
 * @param {string} migrationsDir - Migrations directory path
 * @returns {Array<{number: number, type: "schema" | "diff", path: string}>} Migration files sorted by number
 */
export function getMigrationFiles(
  migrationsDir: string,
): { number: number; type: "schema" | "diff"; path: string }[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const migrations: {
    number: number;
    type: "schema" | "diff";
    path: string;
  }[] = [];

  for (const entry of entries) {
    // Only process directories with valid migration numbers (e.g., "0000", "0001")
    if (!entry.isDirectory()) continue;
    if (!isValidMigrationNumber(entry.name)) continue;

    const num = parseInt(entry.name, 10);
    const migrationDir = path.join(migrationsDir, entry.name);

    // Check for schema.json
    const schemaPath = path.join(migrationDir, SCHEMA_FILE_NAME);
    if (fs.existsSync(schemaPath)) {
      migrations.push({
        number: num,
        type: "schema",
        path: schemaPath,
      });
    }

    // Check for diff.json
    const diffPath = path.join(migrationDir, DIFF_FILE_NAME);
    if (fs.existsSync(diffPath)) {
      migrations.push({
        number: num,
        type: "diff",
        path: diffPath,
      });
    }
  }

  // Sort by number
  return migrations.toSorted((a, b) => a.number - b.number);
}

/**
 * Get the next migration number for a directory
 * Returns INITIAL_SCHEMA_NUMBER (0) if no migrations exist
 * @param {string} migrationsDir - Migrations directory path
 * @returns {number} Next migration number
 */
export function getNextMigrationNumber(migrationsDir: string): number {
  const files = getMigrationFiles(migrationsDir);
  if (files.length === 0) return INITIAL_SCHEMA_NUMBER;
  return Math.max(...files.map((f) => f.number)) + 1;
}

/**
 * Get the latest migration number from a directory
 * Returns 0 if no migrations exist
 * @param {string} migrationsDir - Migrations directory path
 * @returns {number} Latest migration number or 0 if no migrations exist
 */
export function getLatestMigrationNumber(migrationsDir: string): number {
  return latestMigrationNumber(getMigrationFiles(migrationsDir));
}

function latestMigrationNumber(files: { number: number }[]): number {
  if (files.length === 0) return 0;
  return Math.max(...files.map((f) => f.number));
}

/**
 * Assert that a migration number exists in the local migration history.
 * 0 is always accepted as the baseline snapshot.
 *
 * Returns the latest migration number so callers that need it (e.g. sync's
 * post-sync hint) can reuse this function's directory scan instead of
 * scanning the migrations directory a second time.
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} migrationNumber - Migration number to check
 * @returns {number} The latest migration number in the history
 */
export function assertMigrationNumberExists(
  migrationsDir: string,
  migrationNumber: number,
): number {
  const files = getMigrationFiles(migrationsDir);
  if (migrationNumber !== 0 && !files.some((f) => f.number === migrationNumber)) {
    throw new Error(
      `Migration ${formatMigrationNumber(migrationNumber)} does not exist in working tree (latest is ${formatMigrationNumber(latestMigrationNumber(files))}).`,
    );
  }
  return latestMigrationNumber(files);
}

// ============================================================================
// Snapshot Writing
// ============================================================================

/**
 * Write a schema snapshot to a file (creates directory structure)
 * @param {SchemaSnapshot} snapshot - Snapshot to write
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} num - Migration number
 * @returns {string} Path to the written file
 */
export function writeSnapshot(
  snapshot: SchemaSnapshot,
  migrationsDir: string,
  num: number,
): string {
  const migrationDir = getMigrationDirPath(migrationsDir, num);
  fs.mkdirSync(migrationDir, { recursive: true });
  const filePath = getMigrationFilePath(migrationsDir, num, "schema");
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}

/**
 * Write a migration diff to a file (creates directory structure)
 * @param {MigrationDiff} diff - Diff to write
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} num - Migration number
 * @returns {string} Path to the written file
 */
export function writeDiff(diff: MigrationDiff, migrationsDir: string, num: number): string {
  const migrationDir = getMigrationDirPath(migrationsDir, num);
  fs.mkdirSync(migrationDir, { recursive: true });
  const filePath = getMigrationFilePath(migrationsDir, num, "diff");
  fs.writeFileSync(filePath, JSON.stringify(diff, null, 2));
  return filePath;
}
