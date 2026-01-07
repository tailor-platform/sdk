/**
 * Schema snapshot management for TailorDB migrations
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type SchemaSnapshot,
  type SnapshotType,
  type SnapshotFieldConfig,
  type MigrationDiff,
  type DiffChange,
  type BreakingChangeInfo,
  SCHEMA_SNAPSHOT_VERSION,
  SCHEMA_FILE_NAME,
  DIFF_FILE_NAME,
  INITIAL_SCHEMA_NUMBER,
  formatMigrationNumber,
  isValidMigrationNumber,
  getMigrationDirPath,
  getMigrationFilePath,
} from "./types";
import type { ParsedTailorDBType, ParsedField } from "@/parser/service/tailordb/types";

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
  const migrations: { number: number; type: "schema" | "diff"; path: string }[] = [];

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
 * @returns {SchemaSnapshot | null} Reconstructed snapshot or null if no migrations exist
 */
export function reconstructSnapshotFromMigrations(migrationsDir: string): SchemaSnapshot | null {
  const files = getMigrationFiles(migrationsDir);
  if (files.length === 0) return null;

  // Find the initial schema file (should be 0000/schema.json)
  const schemaFile = files.find((f) => f.type === "schema" && f.number === INITIAL_SCHEMA_NUMBER);
  if (!schemaFile) {
    throw new Error(
      `No initial schema file found in ${migrationsDir}. Expected ${formatMigrationNumber(INITIAL_SCHEMA_NUMBER)}/schema.json`,
    );
  }

  let snapshot = loadSnapshot(schemaFile.path);

  // Apply all subsequent diffs in order
  for (const file of files) {
    if (file.type === "diff" && file.number > schemaFile.number) {
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

  // Compare allowedValues
  const oldAllowed = oldField.allowedValues ?? [];
  const newAllowed = newField.allowedValues ?? [];
  if (oldAllowed.length !== newAllowed.length) return true;
  if (!oldAllowed.every((v, i) => v === newAllowed[i])) return true;

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

  // Field type changed - breaking
  if (oldField && newField && oldField.type !== newField.type) {
    return {
      typeName,
      fieldName,
      reason: `Field type changed from ${oldField.type} to ${newField.type}`,
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

  // Array to single value - breaking (existing array data would be lost)
  if (oldField && newField && (oldField.array ?? false) && !(newField.array ?? false)) {
    return {
      typeName,
      fieldName,
      reason: "Field changed from array to single value",
    };
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
 * Compare two snapshots and generate a diff
 * @param {SchemaSnapshot} previous - Previous schema snapshot
 * @param {SchemaSnapshot} current - Current schema snapshot
 * @returns {MigrationDiff} Migration diff between snapshots
 */
export function compareSnapshots(previous: SchemaSnapshot, current: SchemaSnapshot): MigrationDiff {
  const changes: DiffChange[] = [];
  const breakingChanges: BreakingChangeInfo[] = [];
  let hasBreakingChanges = false;

  const previousTypeNames = new Set(Object.keys(previous.types));
  const currentTypeNames = new Set(Object.keys(current.types));

  // Check for added types
  for (const typeName of currentTypeNames) {
    if (!previousTypeNames.has(typeName)) {
      changes.push({
        kind: "type_added",
        typeName,
        after: current.types[typeName],
      });
    }
  }

  // Check for removed types
  for (const typeName of previousTypeNames) {
    if (!currentTypeNames.has(typeName)) {
      changes.push({
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
    const prevFieldNames = new Set(Object.keys(prevType.fields));
    const currFieldNames = new Set(Object.keys(currType.fields));

    // Check for added fields
    for (const fieldName of currFieldNames) {
      if (!prevFieldNames.has(fieldName)) {
        changes.push({
          kind: "field_added",
          typeName,
          fieldName,
          after: currType.fields[fieldName],
        });

        const breaking = isBreakingFieldChange(
          typeName,
          fieldName,
          undefined,
          currType.fields[fieldName],
        );
        if (breaking) {
          hasBreakingChanges = true;
          breakingChanges.push(breaking);
        }
      }
    }

    // Check for removed fields
    for (const fieldName of prevFieldNames) {
      if (!currFieldNames.has(fieldName)) {
        changes.push({
          kind: "field_removed",
          typeName,
          fieldName,
          before: prevType.fields[fieldName],
        });

        const breaking = isBreakingFieldChange(
          typeName,
          fieldName,
          prevType.fields[fieldName],
          undefined,
        );
        if (breaking) {
          hasBreakingChanges = true;
          breakingChanges.push(breaking);
        }
      }
    }

    // Check for modified fields
    for (const fieldName of currFieldNames) {
      if (!prevFieldNames.has(fieldName)) continue;

      const prevField = prevType.fields[fieldName];
      const currField = currType.fields[fieldName];

      if (areFieldsDifferent(prevField, currField)) {
        changes.push({
          kind: "field_modified",
          typeName,
          fieldName,
          before: prevField,
          after: currField,
        });

        const breaking = isBreakingFieldChange(typeName, fieldName, prevField, currField);
        if (breaking) {
          hasBreakingChanges = true;
          breakingChanges.push(breaking);
        }
      }
    }
  }

  // Migration script is required if there are any breaking changes
  const requiresMigrationScript = breakingChanges.length > 0;

  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: current.namespace,
    createdAt: new Date().toISOString(),
    changes,
    hasBreakingChanges,
    breakingChanges,
    requiresMigrationScript,
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
      message: `Initial schema snapshot (${formatMigrationNumber(INITIAL_SCHEMA_NUMBER)}/schema.json) is missing`,
      migrationNumber: INITIAL_SCHEMA_NUMBER,
    });
  }

  // Check for schema files at wrong positions (only 0000 should have schema)
  for (const num of schemaFiles) {
    if (num !== INITIAL_SCHEMA_NUMBER) {
      errors.push({
        type: "invalid_schema_number",
        message: `Schema file found at migration ${formatMigrationNumber(num)}, but schema should only exist at ${formatMigrationNumber(INITIAL_SCHEMA_NUMBER)}`,
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
