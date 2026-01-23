/**
 * Schema snapshot management for TailorDB migrations
 */

import * as fs from "node:fs";
import * as path from "pathe";
import {
  type MigrationDiff,
  type DiffChange,
  type BreakingChangeInfo,
  SCHEMA_SNAPSHOT_VERSION,
} from "./diff-calculator";
import type { ParsedTailorDBType, ParsedField } from "@/parser/service/tailordb/types";

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
export const DIFF_FILE_NAME = "diff.json";
export const MIGRATE_FILE_NAME = "migrate.ts";
export const DB_TYPES_FILE_NAME = "db.ts";

/**
 * Pattern for validating migration number format (4-digit sequential number)
 * Examples: 0001, 0002, 0003, ...
 */
export const MIGRATION_NUMBER_PATTERN = /^\d{4}$/;

// Re-export SCHEMA_SNAPSHOT_VERSION for convenience
export { SCHEMA_SNAPSHOT_VERSION };

// ============================================================================
// Snapshot Types
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
 * Index configuration in schema snapshot
 */
export interface SnapshotIndexConfig {
  fields: string[];
  unique?: boolean;
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
  indexes?: Record<string, SnapshotIndexConfig>;
  files?: Record<string, string>;
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

// ============================================================================
// Path Helpers
// ============================================================================

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
// Snapshot Creation
// ============================================================================

/**
 * Create a snapshot field config from a parsed field
 * @param {ParsedField} field - Parsed field definition
 * @returns {SnapshotFieldConfig} Snapshot field configuration
 */
function createSnapshotFieldConfig(field: ParsedField): SnapshotFieldConfig {
  const config: SnapshotFieldConfig = {
    type: field.config.type,
    required: field.config.required ?? false,
  };

  if (field.config.array) config.array = true;
  if (field.config.index) config.index = true;
  if (field.config.unique) config.unique = true;
  if (field.config.allowedValues && field.config.allowedValues.length > 0) {
    config.allowedValues = field.config.allowedValues.map((v) => v.value);
  }
  if (field.config.foreignKey) {
    config.foreignKey = true;
    if (field.config.foreignKeyType) config.foreignKeyType = field.config.foreignKeyType;
    if (field.config.foreignKeyField) config.foreignKeyField = field.config.foreignKeyField;
  }

  return config;
}

/**
 * Create a snapshot type from a parsed type
 * @param {ParsedTailorDBType} type - Parsed TailorDB type definition
 * @returns {SnapshotType} Snapshot type configuration
 */
function createSnapshotType(type: ParsedTailorDBType): SnapshotType {
  const fields: Record<string, SnapshotFieldConfig> = {};

  for (const [fieldName, field] of Object.entries(type.fields)) {
    fields[fieldName] = createSnapshotFieldConfig(field);
  }

  const snapshotType: SnapshotType = {
    name: type.name,
    fields,
  };

  if (type.pluralForm) snapshotType.pluralForm = type.pluralForm;
  if (type.description) snapshotType.description = type.description;
  if (type.settings) {
    snapshotType.settings = {};
    if (type.settings.aggregation !== undefined) {
      snapshotType.settings.aggregation = type.settings.aggregation;
    }
    if (type.settings.bulkUpsert !== undefined) {
      snapshotType.settings.bulkUpsert = type.settings.bulkUpsert;
    }
  }

  if (type.indexes && Object.keys(type.indexes).length > 0) {
    snapshotType.indexes = {};
    for (const [indexName, indexConfig] of Object.entries(type.indexes)) {
      snapshotType.indexes[indexName] = {
        fields: indexConfig.fields,
        unique: indexConfig.unique,
      };
    }
  }

  if (type.files && Object.keys(type.files).length > 0) {
    snapshotType.files = { ...type.files };
  }

  return snapshotType;
}

/**
 * Create a schema snapshot from local type definitions
 * @param {Record<string, ParsedTailorDBType>} types - Local type definitions
 * @param {string} namespace - Namespace for the snapshot
 * @returns {SchemaSnapshot} Schema snapshot
 */
export function createSnapshotFromLocalTypes(
  types: Record<string, ParsedTailorDBType>,
  namespace: string,
): SchemaSnapshot {
  const snapshotTypes: Record<string, SnapshotType> = {};

  for (const [typeName, type] of Object.entries(types)) {
    snapshotTypes[typeName] = createSnapshotType(type);
  }

  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace,
    createdAt: new Date().toISOString(),
    types: snapshotTypes,
  };
}

// ============================================================================
// Snapshot Loading
// ============================================================================

/**
 * Load a schema snapshot from a file
 * @param {string} filePath - Path to the snapshot file
 * @returns {SchemaSnapshot} Loaded schema snapshot
 */
export function loadSnapshot(filePath: string): SchemaSnapshot {
  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content) as SchemaSnapshot;
}

/**
 * Load a migration diff from a file
 * @param {string} filePath - Path to the diff file
 * @returns {MigrationDiff} Loaded migration diff
 */
export function loadDiff(filePath: string): MigrationDiff {
  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content) as MigrationDiff;
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
  migrations.sort((a, b) => a.number - b.number);
  return migrations;
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
 * @returns {SchemaSnapshot} Resulting snapshot after applying diff
 */
function applyDiffToSnapshot(snapshot: SchemaSnapshot, diff: MigrationDiff): SchemaSnapshot {
  const types = { ...snapshot.types };

  for (const change of diff.changes) {
    switch (change.kind) {
      case "type_added":
        types[change.typeName] = change.after as SnapshotType;
        break;
      case "type_removed":
        delete types[change.typeName];
        break;
      case "type_modified":
        if (types[change.typeName] && change.after) {
          const after = change.after as {
            indexes?: Record<string, SnapshotIndexConfig>;
            files?: Record<string, string>;
          };
          types[change.typeName] = {
            ...types[change.typeName],
            ...(after.indexes !== undefined && { indexes: after.indexes }),
            ...(after.files !== undefined && { files: after.files }),
          };
        }
        break;
      case "field_added":
      case "field_modified":
        if (types[change.typeName] && change.fieldName) {
          types[change.typeName] = {
            ...types[change.typeName],
            fields: {
              ...types[change.typeName].fields,
              [change.fieldName]: change.after as SnapshotFieldConfig,
            },
          };
        }
        break;
      case "field_removed":
        if (types[change.typeName] && change.fieldName) {
          const { [change.fieldName]: _, ...remainingFields } = types[change.typeName].fields;
          types[change.typeName] = {
            ...types[change.typeName],
            fields: remainingFields,
          };
        }
        break;
    }
  }

  return {
    ...snapshot,
    types,
    createdAt: diff.createdAt,
  };
}

/**
 * Reconstruct the latest schema snapshot from all migration files
 * Returns null if no migrations exist
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} [maxVersion] - Optional maximum migration version to apply
 * @returns {SchemaSnapshot | null} Reconstructed snapshot or null if no migrations exist
 */
export function reconstructSnapshotFromMigrations(
  migrationsDir: string,
  maxVersion?: number,
): SchemaSnapshot | null {
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
  const files = getMigrationFiles(migrationsDir);
  if (files.length === 0) return 0;
  return Math.max(...files.map((f) => f.number));
}

// ============================================================================
// Snapshot Comparison
// ============================================================================

/**
 * Compare two field configs and determine if they are different
 * @param {SnapshotFieldConfig} oldField - Old field configuration
 * @param {SnapshotFieldConfig} newField - New field configuration
 * @returns {boolean} True if fields are different
 */
function areFieldsDifferent(oldField: SnapshotFieldConfig, newField: SnapshotFieldConfig): boolean {
  // Compare required properties
  if (oldField.type !== newField.type) return true;
  if (oldField.required !== newField.required) return true;

  // Compare optional boolean properties (default to false)
  const booleanProps = ["array", "index", "unique", "foreignKey"] as const;
  for (const prop of booleanProps) {
    if ((oldField[prop] ?? false) !== (newField[prop] ?? false)) return true;
  }

  // Compare foreign key properties
  if (oldField.foreignKeyType !== newField.foreignKeyType) return true;
  if (oldField.foreignKeyField !== newField.foreignKeyField) return true;

  // Compare allowedValues (set-based comparison - order doesn't matter)
  const oldAllowed = oldField.allowedValues ?? [];
  const newAllowed = newField.allowedValues ?? [];
  if (oldAllowed.length !== newAllowed.length) return true;
  const newAllowedSet = new Set(newAllowed);
  if (oldAllowed.some((v) => !newAllowedSet.has(v))) return true;

  return false;
}

/**
 * Determine if a field change is a breaking change
 * @param {string} typeName - Name of the type containing the field
 * @param {string} fieldName - Name of the field being changed
 * @param {SnapshotFieldConfig | undefined} oldField - Old field configuration
 * @param {SnapshotFieldConfig | undefined} newField - New field configuration
 * @returns {BreakingChangeInfo | null} Breaking change info or null if not breaking
 */
function isBreakingFieldChange(
  typeName: string,
  fieldName: string,
  oldField: SnapshotFieldConfig | undefined,
  newField: SnapshotFieldConfig | undefined,
): BreakingChangeInfo | null {
  // Field added as required - breaking (existing records don't have this value)
  if (!oldField && newField && newField.required) {
    return {
      typeName,
      fieldName,
      reason: "Required field added",
    };
  }

  // Field type changed - unsupported (requires 3-step migration)
  if (oldField && newField && oldField.type !== newField.type) {
    return {
      typeName,
      fieldName,
      reason: `Field type changed from ${oldField.type} to ${newField.type}`,
      unsupported: true,
      showThreeStepHint: true,
    };
  }

  // Optional to required - breaking
  if (oldField && newField && !oldField.required && newField.required) {
    return {
      typeName,
      fieldName,
      reason: "Field changed from optional to required",
    };
  }

  // Array property changed - unsupported (requires 3-step migration)
  if (oldField && newField && (oldField.array ?? false) !== (newField.array ?? false)) {
    const [fromType, toType] = oldField.array
      ? ["array", "single value"]
      : ["single value", "array"];
    return {
      typeName,
      fieldName,
      reason: `Field changed from ${fromType} to ${toType}`,
      unsupported: true,
      showThreeStepHint: true,
    };
  }

  // Foreign key relationship changed - breaking (existing references may become invalid)
  if (oldField && newField) {
    const oldForeignKeyType = oldField.foreignKeyType;
    const newForeignKeyType = newField.foreignKeyType;
    if (oldForeignKeyType && newForeignKeyType && oldForeignKeyType !== newForeignKeyType) {
      return {
        typeName,
        fieldName,
        reason: `Foreign key target type changed from ${oldForeignKeyType} to ${newForeignKeyType}`,
      };
    }
  }

  // Unique constraint added - breaking (existing duplicate values would violate constraint)
  if (oldField && newField && !(oldField.unique ?? false) && (newField.unique ?? false)) {
    return {
      typeName,
      fieldName,
      reason: "Unique constraint added to field",
    };
  }

  // Enum values removed - breaking (existing records may have removed values)
  if (oldField && newField && oldField.type === "enum" && newField.type === "enum") {
    const oldAllowed = oldField.allowedValues ?? [];
    const newAllowed = newField.allowedValues ?? [];
    const removedValues = oldAllowed.filter((v) => !newAllowed.includes(v));
    if (removedValues.length > 0) {
      return {
        typeName,
        fieldName,
        reason: `Enum values removed: ${removedValues.join(", ")}`,
      };
    }
  }

  return null;
}

/**
 * Context for collecting diff changes and breaking changes
 */
interface DiffContext {
  changes: DiffChange[];
  breakingChanges: BreakingChangeInfo[];
}

function addChange(
  ctx: DiffContext,
  change: DiffChange,
  oldField: SnapshotFieldConfig | undefined,
  newField: SnapshotFieldConfig | undefined,
): void {
  ctx.changes.push(change);

  if (change.fieldName) {
    const breaking = isBreakingFieldChange(change.typeName, change.fieldName, oldField, newField);
    if (breaking) {
      ctx.breakingChanges.push(breaking);
    }
  }
}

function compareTypeFields(
  ctx: DiffContext,
  typeName: string,
  prevType: SnapshotType,
  currType: SnapshotType,
): void {
  const prevFieldNames = new Set(Object.keys(prevType.fields));
  const currFieldNames = new Set(Object.keys(currType.fields));

  // Check for added fields
  for (const fieldName of currFieldNames) {
    if (!prevFieldNames.has(fieldName)) {
      addChange(
        ctx,
        {
          kind: "field_added",
          typeName,
          fieldName,
          after: currType.fields[fieldName],
        },
        undefined,
        currType.fields[fieldName],
      );
    }
  }

  // Check for removed fields
  for (const fieldName of prevFieldNames) {
    if (!currFieldNames.has(fieldName)) {
      addChange(
        ctx,
        {
          kind: "field_removed",
          typeName,
          fieldName,
          before: prevType.fields[fieldName],
        },
        prevType.fields[fieldName],
        undefined,
      );
    }
  }

  // Check for modified fields
  for (const fieldName of currFieldNames) {
    if (!prevFieldNames.has(fieldName)) continue;

    const prevField = prevType.fields[fieldName];
    const currField = currType.fields[fieldName];

    if (areFieldsDifferent(prevField, currField)) {
      addChange(
        ctx,
        {
          kind: "field_modified",
          typeName,
          fieldName,
          before: prevField,
          after: currField,
        },
        prevField,
        currField,
      );
    }
  }
}

/**
 * Compare type-level indexes
 * @param {DiffContext} ctx - Diff context
 * @param {string} typeName - Type name
 * @param {Record<string, SnapshotIndexConfig> | undefined} oldIndexes - Previous indexes
 * @param {Record<string, SnapshotIndexConfig> | undefined} newIndexes - Current indexes
 * @returns {void}
 */
function compareIndexes(
  ctx: DiffContext,
  typeName: string,
  oldIndexes: Record<string, SnapshotIndexConfig> | undefined,
  newIndexes: Record<string, SnapshotIndexConfig> | undefined,
): void {
  const oldKeys = new Set(Object.keys(oldIndexes || {}));
  const newKeys = new Set(Object.keys(newIndexes || {}));

  // Index added
  for (const indexName of newKeys) {
    if (!oldKeys.has(indexName)) {
      ctx.changes.push({
        kind: "type_modified",
        typeName,
        reason: `Index "${indexName}" added`,
        before: { indexes: oldIndexes },
        after: { indexes: newIndexes },
      });
    }
  }

  // Index removed
  for (const indexName of oldKeys) {
    if (!newKeys.has(indexName)) {
      ctx.changes.push({
        kind: "type_modified",
        typeName,
        reason: `Index "${indexName}" removed`,
        before: { indexes: oldIndexes },
        after: { indexes: newIndexes },
      });
    }
  }

  // Index modified
  for (const indexName of newKeys) {
    if (oldKeys.has(indexName)) {
      const oldIndex = oldIndexes![indexName];
      const newIndex = newIndexes![indexName];

      const oldFieldsStr = JSON.stringify(oldIndex.fields.sort());
      const newFieldsStr = JSON.stringify(newIndex.fields.sort());

      if (oldFieldsStr !== newFieldsStr || oldIndex.unique !== newIndex.unique) {
        ctx.changes.push({
          kind: "type_modified",
          typeName,
          reason: `Index "${indexName}" modified`,
          before: { indexes: oldIndexes },
          after: { indexes: newIndexes },
        });
      }
    }
  }
}

/**
 * Compare type-level file fields
 * @param {DiffContext} ctx - Diff context
 * @param {string} typeName - Type name
 * @param {Record<string, string> | undefined} oldFiles - Previous file fields
 * @param {Record<string, string> | undefined} newFiles - Current file fields
 * @returns {void}
 */
function compareFiles(
  ctx: DiffContext,
  typeName: string,
  oldFiles: Record<string, string> | undefined,
  newFiles: Record<string, string> | undefined,
): void {
  const oldKeys = new Set(Object.keys(oldFiles || {}));
  const newKeys = new Set(Object.keys(newFiles || {}));

  // File field added
  for (const fileName of newKeys) {
    if (!oldKeys.has(fileName)) {
      ctx.changes.push({
        kind: "type_modified",
        typeName,
        reason: `File field "${fileName}" added`,
        before: { files: oldFiles },
        after: { files: newFiles },
      });
    }
  }

  // File field removed
  for (const fileName of oldKeys) {
    if (!newKeys.has(fileName)) {
      ctx.changes.push({
        kind: "type_modified",
        typeName,
        reason: `File field "${fileName}" removed`,
        before: { files: oldFiles },
        after: { files: newFiles },
      });
    }
  }

  // File field modified (description changed)
  for (const fileName of newKeys) {
    if (oldKeys.has(fileName)) {
      if (oldFiles![fileName] !== newFiles![fileName]) {
        ctx.changes.push({
          kind: "type_modified",
          typeName,
          reason: `File field "${fileName}" description changed`,
          before: { files: oldFiles },
          after: { files: newFiles },
        });
      }
    }
  }
}

/**
 * Compare two snapshots and generate a diff
 * @param {SchemaSnapshot} previous - Previous schema snapshot
 * @param {SchemaSnapshot} current - Current schema snapshot
 * @returns {MigrationDiff} Migration diff between snapshots
 */
export function compareSnapshots(previous: SchemaSnapshot, current: SchemaSnapshot): MigrationDiff {
  const ctx: DiffContext = { changes: [], breakingChanges: [] };

  const previousTypeNames = new Set(Object.keys(previous.types));
  const currentTypeNames = new Set(Object.keys(current.types));

  // Check for added types
  for (const typeName of currentTypeNames) {
    if (!previousTypeNames.has(typeName)) {
      ctx.changes.push({
        kind: "type_added",
        typeName,
        after: current.types[typeName],
      });
    }
  }

  // Check for removed types
  for (const typeName of previousTypeNames) {
    if (!currentTypeNames.has(typeName)) {
      ctx.changes.push({
        kind: "type_removed",
        typeName,
        before: previous.types[typeName],
      });
    }
  }

  // Check for modified types
  for (const typeName of currentTypeNames) {
    if (!previousTypeNames.has(typeName)) continue;

    const prevType = previous.types[typeName];
    const currType = current.types[typeName];

    // Compare fields
    compareTypeFields(ctx, typeName, prevType, currType);

    // Compare indexes
    compareIndexes(ctx, typeName, prevType.indexes, currType.indexes);

    // Compare file fields
    compareFiles(ctx, typeName, prevType.files, currType.files);
  }

  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: current.namespace,
    createdAt: new Date().toISOString(),
    changes: ctx.changes,
    hasBreakingChanges: ctx.breakingChanges.length > 0,
    breakingChanges: ctx.breakingChanges,
    requiresMigrationScript: ctx.breakingChanges.length > 0,
  };
}

/**
 * Compare local types with a snapshot and generate a diff
 * @param {SchemaSnapshot} snapshot - Schema snapshot to compare against
 * @param {Record<string, ParsedTailorDBType>} localTypes - Local type definitions
 * @param {string} namespace - Namespace for comparison
 * @returns {MigrationDiff} Migration diff
 */
export function compareLocalTypesWithSnapshot(
  snapshot: SchemaSnapshot,
  localTypes: Record<string, ParsedTailorDBType>,
  namespace: string,
): MigrationDiff {
  const currentSnapshot = createSnapshotFromLocalTypes(localTypes, namespace);
  return compareSnapshots(snapshot, currentSnapshot);
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
    } else if (file.type === "diff") {
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
  const allNumbers = [...new Set([...schemaFiles, ...diffFiles])].sort((a, b) => a - b);

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

// ============================================================================
// Schema Filtering
// ============================================================================

/**
 * Filter a ParsedTailorDBType to match the schema state in a snapshot
 * This is used when TAILOR_INTERNAL_APPLY_MIGRATION_VERSION is specified to ensure
 * the deployed schema matches the specified migration version
 * @param {ParsedTailorDBType} type - Local parsed type (latest state)
 * @param {SnapshotType} snapshotType - Target snapshot state
 * @returns {ParsedTailorDBType} Filtered type matching the snapshot
 */
export function filterTypeToSnapshot(
  type: ParsedTailorDBType,
  snapshotType: SnapshotType,
): ParsedTailorDBType {
  // Filter fields to only include those in the snapshot
  const filteredFields: Record<string, ParsedField> = {};

  // Always include 'id' field (system field)
  if (type.fields.id) {
    filteredFields.id = type.fields.id;
  }

  // Include fields from snapshot
  for (const fieldName of Object.keys(snapshotType.fields)) {
    if (type.fields[fieldName]) {
      // Use field config from snapshot to ensure correct state (required, enum values, etc.)
      const snapshotFieldConfig = snapshotType.fields[fieldName];
      const localField = type.fields[fieldName];

      // Create a new field with config from snapshot but preserve relationships from local
      filteredFields[fieldName] = {
        ...localField,
        config: {
          ...localField.config,
          required: snapshotFieldConfig.required,
          index: snapshotFieldConfig.index || false,
          unique: snapshotFieldConfig.unique || false,
          ...(snapshotFieldConfig.type === "enum" &&
            snapshotFieldConfig.allowedValues && {
              allowedValues: snapshotFieldConfig.allowedValues.map((v) =>
                typeof v === "string" ? { value: v } : v,
              ),
            }),
        },
      };
    }
  }

  // Filter indexes to only include those in the snapshot
  const filteredIndexes: Record<string, { fields: string[]; unique?: boolean }> = {};
  if (snapshotType.indexes) {
    for (const [indexName, indexConfig] of Object.entries(snapshotType.indexes)) {
      filteredIndexes[indexName] = {
        fields: indexConfig.fields,
        unique: indexConfig.unique,
      };
    }
  }

  // Filter file fields to only include those in the snapshot
  const filteredFiles: Record<string, string> = {};
  if (snapshotType.files) {
    for (const [fileName, description] of Object.entries(snapshotType.files)) {
      filteredFiles[fileName] = description;
    }
  }

  return {
    ...type,
    fields: filteredFields,
    indexes: Object.keys(filteredIndexes).length > 0 ? filteredIndexes : undefined,
    files: Object.keys(filteredFiles).length > 0 ? filteredFiles : undefined,
  };
}
