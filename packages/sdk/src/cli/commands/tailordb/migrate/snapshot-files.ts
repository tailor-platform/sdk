import * as fs from "node:fs";
import * as path from "pathe";
import { z } from "zod";
import { type MigrationDiff } from "./diff-calculator";
import { formatMigrationNumber } from "./migration-number";
import {
  assertSupportedMigrationFileVersion,
  copySnapshotRecord,
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
 * Apply a diff to a snapshot to get the resulting snapshot
 * @param {SchemaSnapshot} snapshot - Base snapshot to apply diff to
 * @param {MigrationDiff} diff - Diff to apply
 * @returns {NormalizedSchemaSnapshot} Normalized snapshot after applying diff
 */
function applyDiffToSnapshot(
  snapshot: SchemaSnapshot,
  diff: MigrationDiff,
): NormalizedSchemaSnapshot {
  const tables = copySnapshotRecord(snapshot.tables);

  for (const change of diff.changes) {
    switch (change.kind) {
      case "table_added":
        tables[change.tableName] = change.after;
        break;
      case "table_removed":
        delete tables[change.tableName];
        break;
      case "table_modified": {
        const existing = tables[change.tableName];
        if (existing && change.after) {
          const after = change.after;
          tables[change.tableName] = {
            ...existing,
            ...(after.indexes !== undefined && { indexes: after.indexes }),
            ...(after.files !== undefined && { files: after.files }),
          };
        }
        break;
      }
      case "table_settings_modified": {
        const existing = tables[change.tableName];
        if (existing) {
          tables[change.tableName] = {
            ...existing,
            description: change.after.description,
            pluralForm: change.after.pluralForm,
            settings: change.after.settings ?? {},
          };
        }
        break;
      }
      case "table_scripts_modified": {
        const existing = tables[change.tableName];
        if (existing) {
          const { typeHookExpr: _, typeValidateExpr: __, ...rest } = existing;
          tables[change.tableName] = {
            ...rest,
            ...(change.after.typeHookExpr && { typeHookExpr: change.after.typeHookExpr }),
            ...(change.after.typeValidateExpr !== undefined && {
              typeValidateExpr: change.after.typeValidateExpr,
            }),
          };
        }
        break;
      }
      case "field_added":
      case "field_modified":
      case "field_type_modified": {
        const existing = tables[change.tableName];
        if (existing) {
          const fields = copySnapshotRecord(existing.fields);
          fields[change.fieldName] = change.after;
          tables[change.tableName] = {
            ...existing,
            fields,
          };
        }
        break;
      }
      case "field_removed": {
        const existing = tables[change.tableName];
        if (existing) {
          const remainingFields = copySnapshotRecord(existing.fields);
          delete remainingFields[change.fieldName];
          tables[change.tableName] = {
            ...existing,
            fields: remainingFields,
          };
        }
        break;
      }
      case "field_renamed": {
        const existing = tables[change.tableName];
        if (existing) {
          const fields = copySnapshotRecord(existing.fields);
          delete fields[change.previousFieldName];
          fields[change.fieldName] = change.after;
          tables[change.tableName] = {
            ...existing,
            fields,
          };
        }
        break;
      }
      case "table_renamed":
        delete tables[change.previousTableName];
        tables[change.tableName] = change.after;
        break;
      case "index_added":
      case "index_modified": {
        const existing = tables[change.tableName];
        if (existing) {
          const indexes = copySnapshotRecord(existing.indexes);
          indexes[change.indexName] = change.after;
          tables[change.tableName] = {
            ...existing,
            indexes,
          };
        }
        break;
      }
      case "index_removed": {
        const existing = tables[change.tableName];
        if (existing && existing.indexes) {
          const remainingIndexes = copySnapshotRecord(existing.indexes);
          delete remainingIndexes[change.indexName];
          tables[change.tableName] = {
            ...existing,
            indexes: Object.keys(remainingIndexes).length > 0 ? remainingIndexes : undefined,
          };
        }
        break;
      }
      case "file_added":
      case "file_modified": {
        const existing = tables[change.tableName];
        if (existing) {
          const files = copySnapshotRecord(existing.files);
          files[change.fieldName] = change.after;
          tables[change.tableName] = {
            ...existing,
            files,
          };
        }
        break;
      }
      case "file_removed": {
        const existing = tables[change.tableName];
        if (existing && existing.files) {
          const remainingFiles = copySnapshotRecord(existing.files);
          delete remainingFiles[change.fieldName];
          tables[change.tableName] = {
            ...existing,
            files: Object.keys(remainingFiles).length > 0 ? remainingFiles : undefined,
          };
        }
        break;
      }
      case "relationship_added":
      case "relationship_modified": {
        const existing = tables[change.tableName];
        if (existing) {
          const rel = change.after;
          // Use relationshipType if specified, fallback to existing logic for backwards compatibility
          const targetType =
            change.relationshipType ??
            (existing.forwardRelationships?.[change.relationshipName]
              ? "forward"
              : existing.backwardRelationships?.[change.relationshipName]
                ? "backward"
                : "forward");

          if (targetType === "forward") {
            const forwardRelationships = copySnapshotRecord(existing.forwardRelationships);
            forwardRelationships[change.relationshipName] = rel;
            tables[change.tableName] = {
              ...existing,
              forwardRelationships,
            };
          } else {
            const backwardRelationships = copySnapshotRecord(existing.backwardRelationships);
            backwardRelationships[change.relationshipName] = rel;
            tables[change.tableName] = {
              ...existing,
              backwardRelationships,
            };
          }
        }
        break;
      }
      case "relationship_removed": {
        const type = tables[change.tableName];
        if (type) {
          // Use relationshipType if specified
          const targetType =
            change.relationshipType ??
            (type.forwardRelationships?.[change.relationshipName]
              ? "forward"
              : type.backwardRelationships?.[change.relationshipName]
                ? "backward"
                : null);

          if (targetType === "forward" && type.forwardRelationships?.[change.relationshipName]) {
            const remaining = copySnapshotRecord(type.forwardRelationships);
            delete remaining[change.relationshipName];
            tables[change.tableName] = {
              ...type,
              forwardRelationships: Object.keys(remaining).length > 0 ? remaining : undefined,
            };
          } else if (
            targetType === "backward" &&
            type.backwardRelationships?.[change.relationshipName]
          ) {
            const remaining = copySnapshotRecord(type.backwardRelationships);
            delete remaining[change.relationshipName];
            tables[change.tableName] = {
              ...type,
              backwardRelationships: Object.keys(remaining).length > 0 ? remaining : undefined,
            };
          }
        }
        break;
      }
      case "permission_modified": {
        const existing = tables[change.tableName];
        if (existing && change.after) {
          const after = change.after;
          tables[change.tableName] = {
            ...existing,
            permissions: {
              record: after.recordPermission,
              gql: after.gqlPermission,
            },
          };
        }
        break;
      }
    }
  }

  return normalizeSchemaSnapshot({
    ...snapshot,
    tables,
    createdAt: diff.createdAt,
  });
}

/**
 * Reconstruct the latest schema snapshot from all migration files
 * Returns null if no migrations exist
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} [maxVersion] - Optional maximum migration version to apply
 * @returns {NormalizedSchemaSnapshot | null} Reconstructed normalized snapshot or null if no migrations exist
 */
export function reconstructSnapshotFromMigrations(
  migrationsDir: string,
  maxVersion?: number,
): NormalizedSchemaSnapshot | null {
  const files = getMigrationFiles(migrationsDir);
  if (files.length === 0) return null;

  // Find the initial schema file (should be 0000/schema.json)
  const schemaFile = files.find((f) => f.type === "schema" && f.number === INITIAL_SCHEMA_NUMBER);
  if (!schemaFile) {
    throw new Error(
      `No initial schema file found in ${migrationsDir}. Expected ${formatMigrationNumber(
        INITIAL_SCHEMA_NUMBER,
      )}/schema.json`,
    );
  }

  let snapshot = loadSnapshot(schemaFile.path);

  // Apply subsequent diffs in order (up to maxVersion if specified)
  for (const file of files) {
    if (file.type === "diff" && file.number > schemaFile.number) {
      // Skip diffs beyond maxVersion if specified
      if (maxVersion !== undefined && file.number > maxVersion) {
        continue;
      }
      const diff = loadDiff(file.path);
      snapshot = applyDiffToSnapshot(snapshot, diff);
    }
  }

  return snapshot;
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

// ============================================================================
// Migration Validation
// ============================================================================

/**
 * Validation error for migration files
 */
export interface MigrationValidationError {
  type: "missing_schema" | "missing_diff" | "duplicate" | "gap" | "invalid_schema_number";
  message: string;
  migrationNumber?: number;
}

/**
 * Validate migration files in a directory
 *
 * Checks:
 * - Schema file exists at 0000 (initial schema)
 * - No gaps in migration numbers
 * - No duplicate migration numbers (schema at 0000, diffs at 1+)
 * - Diff files exist for migrations 1+
 * @param {string} migrationsDir - Migrations directory path
 * @returns {MigrationValidationError[]} Array of validation errors (empty if valid)
 */
export function validateMigrationFiles(migrationsDir: string): MigrationValidationError[] {
  const errors: MigrationValidationError[] = [];

  if (!fs.existsSync(migrationsDir)) {
    // No migrations directory - this is valid (no migrations yet)
    return errors;
  }

  // Use getMigrationFiles to get directory-based migration files
  const migrationFiles = getMigrationFiles(migrationsDir);
  if (migrationFiles.length === 0) {
    // No migration files at all - valid
    return errors;
  }

  // Categorize files by type
  const schemaFiles: number[] = [];
  const diffFiles: number[] = [];

  for (const file of migrationFiles) {
    if (file.type === "schema") {
      schemaFiles.push(file.number);
    } else {
      diffFiles.push(file.number);
    }
  }

  // Check for schema file at INITIAL_SCHEMA_NUMBER (0000)
  if (!schemaFiles.includes(INITIAL_SCHEMA_NUMBER)) {
    errors.push({
      type: "missing_schema",
      message: `Initial schema snapshot (${formatMigrationNumber(
        INITIAL_SCHEMA_NUMBER,
      )}/schema.json) is missing`,
      migrationNumber: INITIAL_SCHEMA_NUMBER,
    });
  }

  // Check for schema files at wrong positions (only 0000 should have schema)
  for (const num of schemaFiles) {
    if (num !== INITIAL_SCHEMA_NUMBER) {
      errors.push({
        type: "invalid_schema_number",
        message: `Schema file found at migration ${formatMigrationNumber(
          num,
        )}, but schema should only exist at ${formatMigrationNumber(INITIAL_SCHEMA_NUMBER)}`,
        migrationNumber: num,
      });
    }
  }

  // Get all migration numbers
  const allNumbers = [...new Set([...schemaFiles, ...diffFiles])].toSorted((a, b) => a - b);

  if (allNumbers.length === 0) {
    return errors;
  }

  // Check for duplicate files (same number with both schema and diff, except for INITIAL_SCHEMA_NUMBER)
  for (const num of schemaFiles) {
    if (num !== INITIAL_SCHEMA_NUMBER && diffFiles.includes(num)) {
      errors.push({
        type: "duplicate",
        message: `Migration ${formatMigrationNumber(num)} has both schema and diff files`,
        migrationNumber: num,
      });
    }
  }

  // Check for gaps in sequence (from INITIAL_SCHEMA_NUMBER to max)
  const maxNum = Math.max(...allNumbers);
  for (let i = INITIAL_SCHEMA_NUMBER; i <= maxNum; i++) {
    if (!allNumbers.includes(i)) {
      errors.push({
        type: "gap",
        message: `Migration ${formatMigrationNumber(i)} is missing (gap in sequence)`,
        migrationNumber: i,
      });
    }
  }

  // Check that migrations > INITIAL_SCHEMA_NUMBER have diff files
  for (const num of allNumbers) {
    if (num > INITIAL_SCHEMA_NUMBER && !diffFiles.includes(num)) {
      errors.push({
        type: "missing_diff",
        message: `Migration ${formatMigrationNumber(num)} is missing diff file`,
        migrationNumber: num,
      });
    }
  }

  return errors;
}

/**
 * Validate migration files and throw if invalid
 * @param {string} migrationsDir - Migrations directory path
 * @param {string} namespace - Namespace for error messages
 * @throws {Error} If validation fails
 */
export function assertValidMigrationFiles(migrationsDir: string, namespace: string): void {
  const errors = validateMigrationFiles(migrationsDir);
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => `  - ${e.message}`).join("\n");
    throw new Error(
      `Migration file validation failed for namespace "${namespace}":\n${errorMessages}`,
    );
  }
}
