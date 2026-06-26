/**
 * Schema snapshot management for TailorDB migrations
 */

import * as fs from "node:fs";
import * as inflection from "inflection";
import * as path from "pathe";
import { z } from "zod";
import { assertDefined } from "#/utils/assert";
import {
  type MigrationDiff,
  type DiffChange,
  type FieldDiffChange,
  type BreakingChangeInfo,
  type WarningChangeInfo,
  SCHEMA_SNAPSHOT_VERSION,
} from "./diff-calculator";
import { formatMigrationNumber } from "./migration-number";
import { schemaSnapshotSchema, migrationDiffSchema } from "./snapshot-schema";
import type {
  ParsedField,
  TailorDBType,
  OperatorFieldConfig,
  StandardActionPermission,
} from "#/parser/service/tailordb/types";
import type {
  NormalizedSchemaSnapshot,
  SchemaSnapshot,
  SnapshotActionPermission,
  SnapshotFieldConfig,
  SnapshotGqlAction,
  SnapshotGqlPermission,
  SnapshotIndexConfig,
  SnapshotPermissionCondition,
  SnapshotRecordPermission,
  SnapshotRelationship,
  TailorDBSnapshotType,
} from "./snapshot-types";
import type { SchemaDrift } from "./types";
import type { TailorDBType as ProtoTailorDBType } from "@tailor-platform/tailor-proto/tailordb_resource_pb";

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
/** File name for generated DB type definitions. */
export const DB_TYPES_FILE_NAME = "db.ts";

/**
 * Pattern for validating migration number format (4-digit sequential number)
 * Examples: 0001, 0002, 0003, ...
 */
export const MIGRATION_NUMBER_PATTERN = /^\d{4}$/;

/**
 * Platform default scale for decimal fields when scale is not explicitly specified.
 * Must stay in sync with the platform's default decimal scale.
 */
export const DEFAULT_DECIMAL_SCALE = 6;

function createSnapshotRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function copySnapshotRecord<T>(record: Record<string, T> | undefined): Record<string, T> {
  const copy = createSnapshotRecord<T>();
  for (const [key, value] of Object.entries(record ?? {})) {
    copy[key] = value;
  }
  return copy;
}

/**
 * Normalize a snapshot field in place so the snapshot becomes the canonical
 * form for comparison. Currently fills in the platform default decimal scale
 * when omitted, which avoids false drift between local schemas (where scale
 * may be omitted) and the platform (which always materializes a scale).
 * @param {SnapshotFieldConfig} field - Field configuration to normalize
 * @returns The same field object after normalization
 */
function normalizeSnapshotField(field: SnapshotFieldConfig): SnapshotFieldConfig {
  if (field.type === "decimal" && field.scale === undefined) {
    field.scale = DEFAULT_DECIMAL_SCALE;
  }
  if (field.fields) {
    for (const nested of Object.values(field.fields)) {
      normalizeSnapshotField(nested);
    }
  }
  return field;
}

/**
 * Normalize a snapshot type in place to the canonical comparison shape.
 * Currently fills:
 *   - `pluralForm` via inflection when missing (legacy snapshots written
 *     before `pluralForm` became required may omit it)
 *   - per-field `scale` defaults via {@link normalizeSnapshotField}
 *
 * Idempotent — safe to call multiple times on the same input.
 * @param {TailorDBSnapshotType} type - Snapshot type to normalize
 * @returns The same snapshot type object after normalization
 */
function normalizeSnapshotType(type: TailorDBSnapshotType): TailorDBSnapshotType {
  // `pluralForm` is typed as required by TailorDBSnapshotType, but JSON.parse'd legacy
  // snapshots may have it undefined at runtime — backfill from inflection.
  if (!(type as { pluralForm?: string }).pluralForm) {
    type.pluralForm = inflection.pluralize(type.name);
  }
  for (const field of Object.values(type.fields)) {
    normalizeSnapshotField(field);
  }
  return type;
}

/**
 * Normalize a schema snapshot in place to the canonical comparison shape.
 * @param {SchemaSnapshot} snapshot - Schema snapshot to normalize
 * @returns The same schema snapshot object branded as normalized
 */
export function normalizeSchemaSnapshot(snapshot: SchemaSnapshot): NormalizedSchemaSnapshot {
  for (const type of Object.values(snapshot.types)) {
    normalizeSnapshotType(type);
  }
  return snapshot as NormalizedSchemaSnapshot;
}

// Re-export SCHEMA_SNAPSHOT_VERSION for convenience
export { SCHEMA_SNAPSHOT_VERSION };
export { formatMigrationNumber };

// ============================================================================
// Snapshot Types
// ============================================================================

// Snapshot data-model types live in snapshot-types.ts (leaf module shared
// with diff-calculator.ts). Re-exported here for backward compatibility.
export { isSnapshotFieldRefOperand } from "./snapshot-types";
export type {
  SnapshotHook,
  SnapshotValidation,
  SnapshotSerial,
  SnapshotEnumValue,
  SnapshotFieldConfig,
  SnapshotIndexConfig,
  SnapshotRelationship,
  SnapshotFieldRefOperand,
  SnapshotValueOperand,
  SnapshotPermissionOperand,
  SnapshotPermissionOperator,
  SnapshotPermissionCondition,
  SnapshotActionPermission,
  SnapshotRecordPermission,
  SnapshotGqlAction,
  SnapshotGqlPermissionPolicy,
  SnapshotGqlPermission,
  TailorDBSnapshotType,
  SchemaSnapshot,
  NormalizedSchemaSnapshot,
} from "./snapshot-types";

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
 * Parse migration number from file name
 * @param {string} fileName - File name (e.g., "0001_schema.json")
 * @returns {number | null} Parsed number or null if invalid
 */
export function parseMigrationNumber(fileName: string): number | null {
  const match = fileName.match(/^(\d{4})_/);
  if (!match) return null;
  const [, digits] = match;
  const num = parseInt(
    assertDefined(digits, "parseMigrationNumber: regex capture group missing"),
    10,
  );
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
  // Note: Use `!== false` to match generateParsedTailorDBTypeManifest behavior
  // where undefined defaults to true (required by default in SDK)
  const config: SnapshotFieldConfig = {
    type: field.config.type,
    required: field.config.required !== false,
  };

  if (field.config.array) config.array = true;
  if (field.config.index) config.index = true;
  if (field.config.unique) config.unique = true;

  if (field.config.allowedValues && field.config.allowedValues.length > 0) {
    config.allowedValues = field.config.allowedValues.map((v) => ({
      value: v.value,
      ...(v.description && { description: v.description }),
    }));
  }

  if (field.config.foreignKey) {
    config.foreignKey = true;
    if (field.config.foreignKeyType) config.foreignKeyType = field.config.foreignKeyType;
    if (field.config.foreignKeyField) config.foreignKeyField = field.config.foreignKeyField;
  }

  if (field.config.description) config.description = field.config.description;
  if (field.config.vector) config.vector = true;

  if (field.config.hooks) {
    config.hooks = {};
    if (field.config.hooks.create) {
      config.hooks.create = { expr: field.config.hooks.create.expr };
    }
    if (field.config.hooks.update) {
      config.hooks.update = { expr: field.config.hooks.update.expr };
    }
  }

  if (field.config.validate && field.config.validate.length > 0) {
    config.validate = field.config.validate.map((v) => ({
      script: { expr: v.script.expr },
      errorMessage: v.errorMessage,
    }));
  }

  if (field.config.serial) {
    config.serial = {
      start: field.config.serial.start,
      ...(field.config.serial.maxValue !== undefined && { maxValue: field.config.serial.maxValue }),
      ...(field.config.serial.format && { format: field.config.serial.format }),
    };
  }

  if (field.config.scale !== undefined) config.scale = field.config.scale;

  if (field.config.fields && Object.keys(field.config.fields).length > 0) {
    config.fields = {};
    for (const [nestedName, nestedConfig] of Object.entries(field.config.fields)) {
      config.fields[nestedName] = createSnapshotFieldConfigFromOperatorConfig(nestedConfig);
    }
  }

  normalizeSnapshotField(config);
  return config;
}

/**
 * Create a snapshot field config from an OperatorFieldConfig (for nested fields)
 * @param {import("#/parser/service/tailordb/types").OperatorFieldConfig} fieldConfig - Field configuration
 * @returns {SnapshotFieldConfig} Snapshot field configuration
 */
function createSnapshotFieldConfigFromOperatorConfig(
  fieldConfig: OperatorFieldConfig,
): SnapshotFieldConfig {
  const config: SnapshotFieldConfig = {
    type: fieldConfig.type,
    required: fieldConfig.required !== false,
  };

  if (fieldConfig.array) config.array = true;
  if (fieldConfig.index) config.index = true;
  if (fieldConfig.unique) config.unique = true;

  if (fieldConfig.allowedValues && fieldConfig.allowedValues.length > 0) {
    config.allowedValues = fieldConfig.allowedValues.map((v) => ({
      value: v.value,
      ...(v.description && { description: v.description }),
    }));
  }

  if (fieldConfig.foreignKey) {
    config.foreignKey = true;
    if (fieldConfig.foreignKeyType) config.foreignKeyType = fieldConfig.foreignKeyType;
    if (fieldConfig.foreignKeyField) config.foreignKeyField = fieldConfig.foreignKeyField;
  }

  if (fieldConfig.description) config.description = fieldConfig.description;
  if (fieldConfig.vector) config.vector = true;

  if (fieldConfig.hooks) {
    config.hooks = {};
    if (fieldConfig.hooks.create) {
      config.hooks.create = { expr: fieldConfig.hooks.create.expr };
    }
    if (fieldConfig.hooks.update) {
      config.hooks.update = { expr: fieldConfig.hooks.update.expr };
    }
  }

  if (fieldConfig.validate && fieldConfig.validate.length > 0) {
    config.validate = fieldConfig.validate.map((v) => ({
      script: { expr: v.script.expr },
      errorMessage: v.errorMessage,
    }));
  }

  if (fieldConfig.serial) {
    config.serial = {
      start: fieldConfig.serial.start,
      ...(fieldConfig.serial.maxValue !== undefined && { maxValue: fieldConfig.serial.maxValue }),
      ...(fieldConfig.serial.format && { format: fieldConfig.serial.format }),
    };
  }

  if (fieldConfig.scale !== undefined) config.scale = fieldConfig.scale;

  // Recursive for nested fields
  if (fieldConfig.fields && Object.keys(fieldConfig.fields).length > 0) {
    config.fields = {};
    for (const [nestedName, nestedConfig] of Object.entries(fieldConfig.fields)) {
      config.fields[nestedName] = createSnapshotFieldConfigFromOperatorConfig(nestedConfig);
    }
  }

  normalizeSnapshotField(config);
  return config;
}

/**
 * Create a snapshot type from a parsed type
 * @param {TailorDBType} type - Parsed TailorDB type definition
 * @returns {TailorDBSnapshotType} Snapshot type configuration
 */
export function createSnapshotType(type: TailorDBType): TailorDBSnapshotType {
  const fields = createSnapshotRecord<SnapshotFieldConfig>();

  for (const [fieldName, field] of Object.entries(type.fields)) {
    fields[fieldName] = createSnapshotFieldConfig(field);
  }

  const snapshotType: TailorDBSnapshotType = {
    name: type.name,
    pluralForm: type.pluralForm || inflection.pluralize(type.name),
    fields,
  };

  if (type.description) snapshotType.description = type.description;
  snapshotType.settings = {};
  if (type.settings.aggregation !== undefined) {
    snapshotType.settings.aggregation = type.settings.aggregation;
  }
  if (type.settings.bulkUpsert !== undefined) {
    snapshotType.settings.bulkUpsert = type.settings.bulkUpsert;
  }
  if (type.settings.gqlOperations) {
    // gqlOperations is already normalized by schema transform
    const ops = type.settings.gqlOperations;
    snapshotType.settings.gqlOperations = {
      ...(ops.create !== undefined && {
        create: ops.create,
      }),
      ...(ops.update !== undefined && {
        update: ops.update,
      }),
      ...(ops.delete !== undefined && {
        delete: ops.delete,
      }),
      ...(ops.read !== undefined && {
        read: ops.read,
      }),
    };
  }
  if (type.settings.publishEvents !== undefined) {
    snapshotType.settings.publishEvents = type.settings.publishEvents;
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

  if (Object.keys(type.forwardRelationships).length > 0) {
    snapshotType.forwardRelationships = {};
    for (const [relName, rel] of Object.entries(type.forwardRelationships)) {
      snapshotType.forwardRelationships[relName] = {
        targetType: rel.targetType,
        targetField: rel.targetField,
        sourceField: rel.sourceField,
        isArray: rel.isArray,
        description: rel.description,
      };
    }
  }

  if (Object.keys(type.backwardRelationships).length > 0) {
    snapshotType.backwardRelationships = {};
    for (const [relName, rel] of Object.entries(type.backwardRelationships)) {
      snapshotType.backwardRelationships[relName] = {
        targetType: rel.targetType,
        targetField: rel.targetField,
        sourceField: rel.sourceField,
        isArray: rel.isArray,
        description: rel.description,
      };
    }
  }

  if (type.permissions.record || type.permissions.gql) {
    snapshotType.permissions = {};

    if (type.permissions.record) {
      snapshotType.permissions.record = {
        create: type.permissions.record.create.map(convertActionPermission),
        read: type.permissions.record.read.map(convertActionPermission),
        update: type.permissions.record.update.map(convertActionPermission),
        delete: type.permissions.record.delete.map(convertActionPermission),
      };
    }

    if (type.permissions.gql) {
      snapshotType.permissions.gql = type.permissions.gql.map((policy) => ({
        conditions: policy.conditions as SnapshotPermissionCondition[],
        actions: policy.actions as SnapshotGqlAction[],
        permit: policy.permit,
        ...(policy.description && { description: policy.description }),
      }));
    }
  }

  return normalizeSnapshotType(snapshotType);
}

/**
 * Convert an action permission to snapshot format
 * @param {StandardActionPermission<"record">} permission - Action permission
 * @returns {SnapshotActionPermission} Snapshot action permission
 */
function convertActionPermission(
  permission: StandardActionPermission<"record">,
): SnapshotActionPermission {
  return {
    conditions: permission.conditions as SnapshotPermissionCondition[],
    permit: permission.permit,
    ...(permission.description && { description: permission.description }),
  };
}

/**
 * Create a schema snapshot from local type definitions
 * @param {Record<string, TailorDBType>} types - Local type definitions
 * @param {string} namespace - Namespace for the snapshot
 * @returns {NormalizedSchemaSnapshot} Normalized schema snapshot
 */
export function createSnapshotFromLocalTypes(
  types: Record<string, TailorDBType>,
  namespace: string,
): NormalizedSchemaSnapshot {
  const snapshotTypes = createSnapshotRecord<TailorDBSnapshotType>();

  for (const [typeName, type] of Object.entries(types)) {
    snapshotTypes[typeName] = createSnapshotType(type);
  }

  return normalizeSchemaSnapshot({
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace,
    createdAt: new Date().toISOString(),
    types: snapshotTypes,
  });
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
  const result = schemaSnapshotSchema.safeParse(raw);
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
  const result = migrationDiffSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid migration diff at ${filePath}: ${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  const parsed = result.data;
  // Backfill fields introduced after the initial diff.json schema so that older
  // migrations on disk remain readable without manual edits. hasWarnings is
  // derived from the warnings array to stay consistent even if a hand-edited
  // diff.json sets one side without the other.
  // `warnings` is optional in the schema (backcompat) but cast to required; guard for safety
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  const warnings = parsed.warnings ?? [];
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
  const types = copySnapshotRecord(snapshot.types);

  for (const change of diff.changes) {
    switch (change.kind) {
      case "type_added":
        types[change.typeName] = change.after;
        break;
      case "type_removed":
        delete types[change.typeName];
        break;
      case "type_modified": {
        const existing = types[change.typeName];
        if (existing && change.after) {
          const after = change.after;
          types[change.typeName] = {
            ...existing,
            ...(after.indexes !== undefined && { indexes: after.indexes }),
            ...(after.files !== undefined && { files: after.files }),
          };
        }
        break;
      }
      case "field_added":
      case "field_modified": {
        const existing = types[change.typeName];
        if (existing) {
          const fields = copySnapshotRecord(existing.fields);
          fields[change.fieldName] = change.after;
          types[change.typeName] = {
            ...existing,
            fields,
          };
        }
        break;
      }
      case "field_removed": {
        const existing = types[change.typeName];
        if (existing) {
          const remainingFields = copySnapshotRecord(existing.fields);
          delete remainingFields[change.fieldName];
          types[change.typeName] = {
            ...existing,
            fields: remainingFields,
          };
        }
        break;
      }
      case "index_added":
      case "index_modified": {
        const existing = types[change.typeName];
        if (existing) {
          const indexes = copySnapshotRecord(existing.indexes);
          indexes[change.indexName] = change.after;
          types[change.typeName] = {
            ...existing,
            indexes,
          };
        }
        break;
      }
      case "index_removed": {
        const existing = types[change.typeName];
        if (existing && existing.indexes) {
          const remainingIndexes = copySnapshotRecord(existing.indexes);
          delete remainingIndexes[change.indexName];
          types[change.typeName] = {
            ...existing,
            indexes: Object.keys(remainingIndexes).length > 0 ? remainingIndexes : undefined,
          };
        }
        break;
      }
      case "file_added":
      case "file_modified": {
        const existing = types[change.typeName];
        if (existing) {
          const files = copySnapshotRecord(existing.files);
          files[change.fieldName] = change.after;
          types[change.typeName] = {
            ...existing,
            files,
          };
        }
        break;
      }
      case "file_removed": {
        const existing = types[change.typeName];
        if (existing && existing.files) {
          const remainingFiles = copySnapshotRecord(existing.files);
          delete remainingFiles[change.fieldName];
          types[change.typeName] = {
            ...existing,
            files: Object.keys(remainingFiles).length > 0 ? remainingFiles : undefined,
          };
        }
        break;
      }
      case "relationship_added":
      case "relationship_modified": {
        const existing = types[change.typeName];
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
            types[change.typeName] = {
              ...existing,
              forwardRelationships,
            };
          } else {
            const backwardRelationships = copySnapshotRecord(existing.backwardRelationships);
            backwardRelationships[change.relationshipName] = rel;
            types[change.typeName] = {
              ...existing,
              backwardRelationships,
            };
          }
        }
        break;
      }
      case "relationship_removed": {
        const type = types[change.typeName];
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
            types[change.typeName] = {
              ...type,
              forwardRelationships: Object.keys(remaining).length > 0 ? remaining : undefined,
            };
          } else if (
            targetType === "backward" &&
            type.backwardRelationships?.[change.relationshipName]
          ) {
            const remaining = copySnapshotRecord(type.backwardRelationships);
            delete remaining[change.relationshipName];
            types[change.typeName] = {
              ...type,
              backwardRelationships: Object.keys(remaining).length > 0 ? remaining : undefined,
            };
          }
        }
        break;
      }
      case "permission_modified": {
        const existing = types[change.typeName];
        if (existing && change.after) {
          const after = change.after;
          types[change.typeName] = {
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
    types,
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
  const booleanProps = ["array", "index", "unique", "foreignKey", "vector"] as const;
  for (const prop of booleanProps) {
    if ((oldField[prop] ?? false) !== (newField[prop] ?? false)) return true;
  }

  // Compare foreign key properties
  if (oldField.foreignKeyType !== newField.foreignKeyType) return true;
  if (oldField.foreignKeyField !== newField.foreignKeyField) return true;

  if ((oldField.description ?? "") !== (newField.description ?? "")) return true;

  const oldAllowed = oldField.allowedValues ?? [];
  const newAllowed = newField.allowedValues ?? [];
  if (oldAllowed.length !== newAllowed.length) return true;
  const newAllowedMap = new Map(newAllowed.map((v) => [v.value, v.description]));
  for (const v of oldAllowed) {
    if (!newAllowedMap.has(v.value)) return true;
    if ((v.description ?? "") !== (newAllowedMap.get(v.value) ?? "")) return true;
  }

  const oldHooks = oldField.hooks;
  const newHooks = newField.hooks;
  if (Boolean(oldHooks) !== Boolean(newHooks)) return true;
  if (oldHooks && newHooks) {
    if ((oldHooks.create?.expr ?? "") !== (newHooks.create?.expr ?? "")) return true;
    if ((oldHooks.update?.expr ?? "") !== (newHooks.update?.expr ?? "")) return true;
  }

  const oldValidate = oldField.validate ?? [];
  const newValidate = newField.validate ?? [];
  if (oldValidate.length !== newValidate.length) return true;
  for (let i = 0; i < oldValidate.length; i++) {
    const oldV = assertDefined(oldValidate[i], `oldValidate missing index ${i}`);
    const newV = assertDefined(newValidate[i], `newValidate missing index ${i}`);
    if ((oldV.script?.expr ?? "") !== (newV.script?.expr ?? "")) return true;
    if (oldV.errorMessage !== newV.errorMessage) return true;
  }

  const oldSerial = oldField.serial;
  const newSerial = newField.serial;
  if (Boolean(oldSerial) !== Boolean(newSerial)) return true;
  if (oldSerial && newSerial) {
    if (oldSerial.start !== newSerial.start) return true;
    if (oldSerial.maxValue !== newSerial.maxValue) return true;
    if ((oldSerial.format ?? "") !== (newSerial.format ?? "")) return true;
  }

  if (oldField.scale !== newField.scale) return true;

  const oldFields = oldField.fields ?? {};
  const newFields = newField.fields ?? {};
  const oldFieldNames = Object.keys(oldFields);
  const newFieldNames = Object.keys(newFields);
  if (oldFieldNames.length !== newFieldNames.length) return true;
  for (const fieldName of oldFieldNames) {
    const oldF = oldFields[fieldName];
    const newF = newFields[fieldName];
    if (!newF) return true;
    if (
      areFieldsDifferent(assertDefined(oldF, `field "${fieldName}" missing from oldFields`), newF)
    )
      return true;
  }

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
    const oldValues = oldAllowed.map((v) => v.value);
    const newValuesSet = new Set(newAllowed.map((v) => v.value));
    const removedValues = oldValues.filter((v) => !newValuesSet.has(v));
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
 * Context for collecting diff changes, breaking changes, and warnings
 */
interface DiffContext {
  changes: DiffChange[];
  breakingChanges: BreakingChangeInfo[];
  warnings: WarningChangeInfo[];
}

function addChange(
  ctx: DiffContext,
  change: FieldDiffChange,
  oldField: SnapshotFieldConfig | undefined,
  newField: SnapshotFieldConfig | undefined,
): void {
  ctx.changes.push(change);

  if (!change.fieldName) return;

  const breaking = isBreakingFieldChange(change.typeName, change.fieldName, oldField, newField);
  if (breaking) {
    ctx.breakingChanges.push(breaking);
    return;
  }

  // Non-breaking removal still risks data loss: surface as a warning so users
  // can decide whether to add a migration script (e.g. JOIN through a
  // soon-to-be-dropped foreign key before it disappears).
  if (change.kind === "field_removed") {
    ctx.warnings.push({
      typeName: change.typeName,
      fieldName: change.fieldName,
      reason: "Field removed (existing data will be dropped in the post-migration phase)",
    });
  }
}

function compareTypeFields(
  ctx: DiffContext,
  typeName: string,
  prevType: TailorDBSnapshotType,
  currType: TailorDBSnapshotType,
): void {
  const prevFieldNames = new Set(Object.keys(prevType.fields));
  const currFieldNames = new Set(Object.keys(currType.fields));

  // Check for added fields
  for (const fieldName of currFieldNames) {
    if (!prevFieldNames.has(fieldName)) {
      const currField = assertDefined(
        currType.fields[fieldName],
        `field "${fieldName}" missing from currType`,
      );
      addChange(
        ctx,
        {
          kind: "field_added",
          typeName,
          fieldName,
          after: currField,
        },
        undefined,
        currField,
      );
    }
  }

  // Check for removed fields
  for (const fieldName of prevFieldNames) {
    if (!currFieldNames.has(fieldName)) {
      const prevField = assertDefined(
        prevType.fields[fieldName],
        `field "${fieldName}" missing from prevType`,
      );
      addChange(
        ctx,
        {
          kind: "field_removed",
          typeName,
          fieldName,
          before: prevField,
        },
        prevField,
        undefined,
      );
    }
  }

  // Check for modified fields
  for (const fieldName of currFieldNames) {
    if (!prevFieldNames.has(fieldName)) continue;

    const prevField = assertDefined(
      prevType.fields[fieldName],
      `field "${fieldName}" missing from prevType`,
    );
    const currField = assertDefined(
      currType.fields[fieldName],
      `field "${fieldName}" missing from currType`,
    );

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
  for (const [indexName, indexConfig] of Object.entries(newIndexes ?? {})) {
    if (!oldKeys.has(indexName)) {
      ctx.changes.push({
        kind: "index_added",
        typeName,
        indexName,
        after: indexConfig,
      });
    }
  }

  // Index removed
  for (const [indexName, indexConfig] of Object.entries(oldIndexes ?? {})) {
    if (!newKeys.has(indexName)) {
      ctx.changes.push({
        kind: "index_removed",
        typeName,
        indexName,
        before: indexConfig,
      });
    }
  }

  // Index modified
  for (const [indexName, newIndex] of Object.entries(newIndexes ?? {})) {
    if (oldKeys.has(indexName)) {
      const oldIndex = assertDefined(
        assertDefined(oldIndexes, "oldIndexes is undefined when oldKeys has entry")[indexName],
        `index "${indexName}" missing from oldIndexes`,
      );

      const oldFieldsStr = JSON.stringify(oldIndex.fields.toSorted());
      const newFieldsStr = JSON.stringify(newIndex.fields.toSorted());

      if (oldFieldsStr !== newFieldsStr || oldIndex.unique !== newIndex.unique) {
        const reasons: string[] = [];
        if (oldFieldsStr !== newFieldsStr) reasons.push("fields changed");
        if (oldIndex.unique !== newIndex.unique) reasons.push("unique constraint changed");
        ctx.changes.push({
          kind: "index_modified",
          typeName,
          indexName,
          reason: reasons.join(", "),
          before: oldIndex,
          after: newIndex,
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
  for (const [fileName, fileDesc] of Object.entries(newFiles ?? {})) {
    if (!oldKeys.has(fileName)) {
      ctx.changes.push({
        kind: "file_added",
        typeName,
        fieldName: fileName,
        after: fileDesc,
      });
    }
  }

  // File field removed
  for (const [fileName, fileDesc] of Object.entries(oldFiles ?? {})) {
    if (!newKeys.has(fileName)) {
      ctx.changes.push({
        kind: "file_removed",
        typeName,
        fieldName: fileName,
        before: fileDesc,
      });
    }
  }

  // File field modified (description changed)
  for (const [fileName, newDesc] of Object.entries(newFiles ?? {})) {
    if (oldKeys.has(fileName)) {
      const oldDesc = assertDefined(
        assertDefined(oldFiles, "oldFiles is undefined when oldKeys has entry")[fileName],
        `file "${fileName}" missing from oldFiles`,
      );
      if (oldDesc !== newDesc) {
        ctx.changes.push({
          kind: "file_modified",
          typeName,
          fieldName: fileName,
          reason: "description changed",
          before: oldDesc,
          after: newDesc,
        });
      }
    }
  }
}

/**
 * Compare type-level relationships
 * @param {DiffContext} ctx - Diff context
 * @param {string} typeName - Type name
 * @param {"forward" | "backward"} relationshipType - Relationship direction to compare
 * @param {Record<string, SnapshotRelationship> | undefined} oldRelationships - Previous relationships
 * @param {Record<string, SnapshotRelationship> | undefined} newRelationships - Current relationships
 * @returns {void}
 */
function compareRelationships(
  ctx: DiffContext,
  typeName: string,
  relationshipType: "forward" | "backward",
  oldRelationships: Record<string, SnapshotRelationship> | undefined,
  newRelationships: Record<string, SnapshotRelationship> | undefined,
): void {
  const oldKeys = new Set(Object.keys(oldRelationships || {}));
  const newKeys = new Set(Object.keys(newRelationships || {}));

  // Relationship added
  for (const [relName, rel] of Object.entries(newRelationships ?? {})) {
    if (!oldKeys.has(relName)) {
      ctx.changes.push({
        kind: "relationship_added",
        typeName,
        relationshipName: relName,
        relationshipType,
        after: rel,
      });
    }
  }

  // Relationship removed
  for (const [relName, rel] of Object.entries(oldRelationships ?? {})) {
    if (!newKeys.has(relName)) {
      ctx.changes.push({
        kind: "relationship_removed",
        typeName,
        relationshipName: relName,
        relationshipType,
        before: rel,
      });
    }
  }

  // Relationship modified
  for (const [relName, newRel] of Object.entries(newRelationships ?? {})) {
    if (oldKeys.has(relName)) {
      const oldRel = assertDefined(
        assertDefined(oldRelationships, "oldRelationships is undefined when oldKeys has entry")[
          relName
        ],
        `relationship "${relName}" missing from oldRelationships`,
      );

      const reasons: string[] = [];
      if (oldRel.targetType !== newRel.targetType) reasons.push("targetType changed");
      if (oldRel.targetField !== newRel.targetField) reasons.push("targetField changed");
      if (oldRel.sourceField !== newRel.sourceField) reasons.push("sourceField changed");
      if (oldRel.isArray !== newRel.isArray) reasons.push("isArray changed");

      if (reasons.length > 0) {
        ctx.changes.push({
          kind: "relationship_modified",
          typeName,
          relationshipName: relName,
          relationshipType,
          reason: reasons.join(", "),
          before: oldRel,
          after: newRel,
        });
      }
    }
  }
}

/**
 * Compare type-level permissions
 * @param {DiffContext} ctx - Diff context
 * @param {string} typeName - Type name
 * @param {SnapshotRecordPermission | undefined} oldRecordPerm - Previous record permission
 * @param {SnapshotRecordPermission | undefined} newRecordPerm - Current record permission
 * @param {SnapshotGqlPermission | undefined} oldGqlPerm - Previous GQL permission
 * @param {SnapshotGqlPermission | undefined} newGqlPerm - Current GQL permission
 * @returns {void}
 */
function comparePermissions(
  ctx: DiffContext,
  typeName: string,
  oldRecordPerm: SnapshotRecordPermission | undefined,
  newRecordPerm: SnapshotRecordPermission | undefined,
  oldGqlPerm: SnapshotGqlPermission | undefined,
  newGqlPerm: SnapshotGqlPermission | undefined,
): void {
  // Compare record permissions
  const oldRecordStr = JSON.stringify(oldRecordPerm ?? null);
  const newRecordStr = JSON.stringify(newRecordPerm ?? null);
  const recordPermChanged = oldRecordStr !== newRecordStr;

  // Compare GQL permissions
  const oldGqlStr = JSON.stringify(oldGqlPerm ?? null);
  const newGqlStr = JSON.stringify(newGqlPerm ?? null);
  const gqlPermChanged = oldGqlStr !== newGqlStr;

  if (recordPermChanged || gqlPermChanged) {
    const reasons: string[] = [];
    if (recordPermChanged) reasons.push("record permission");
    if (gqlPermChanged) reasons.push("GQL permission");

    ctx.changes.push({
      kind: "permission_modified",
      typeName,
      reason: `${reasons.join(" and ")} changed`,
      before: { recordPermission: oldRecordPerm, gqlPermission: oldGqlPerm },
      after: { recordPermission: newRecordPerm, gqlPermission: newGqlPerm },
    });
  }
}

/**
 * Compare two snapshots and generate a diff
 * @param {SchemaSnapshot} previous - Previous schema snapshot
 * @param {SchemaSnapshot} current - Current schema snapshot
 * @returns {MigrationDiff} Migration diff between snapshots
 */
export function compareSnapshots(previous: SchemaSnapshot, current: SchemaSnapshot): MigrationDiff {
  return compareNormalizedSnapshots(
    normalizeSchemaSnapshot(previous),
    normalizeSchemaSnapshot(current),
  );
}

function compareNormalizedSnapshots(
  previous: NormalizedSchemaSnapshot,
  current: NormalizedSchemaSnapshot,
): MigrationDiff {
  const ctx: DiffContext = { changes: [], breakingChanges: [], warnings: [] };

  const previousTypeNames = new Set(Object.keys(previous.types));
  const currentTypeNames = new Set(Object.keys(current.types));

  // Check for added types
  for (const [typeName, type] of Object.entries(current.types)) {
    if (!previousTypeNames.has(typeName)) {
      ctx.changes.push({
        kind: "type_added",
        typeName,
        after: type,
      });
    }
  }

  // Check for removed types
  for (const [typeName, type] of Object.entries(previous.types)) {
    if (!currentTypeNames.has(typeName)) {
      ctx.changes.push({
        kind: "type_removed",
        typeName,
        before: type,
      });
      ctx.warnings.push({
        typeName,
        reason:
          "Type removed (all records of this type will be dropped in the post-migration phase)",
      });
    }
  }

  // Check for modified types
  for (const typeName of currentTypeNames) {
    if (!previousTypeNames.has(typeName)) continue;

    const prevType = assertDefined(
      previous.types[typeName],
      `type "${typeName}" missing from previous snapshot`,
    );
    const currType = assertDefined(
      current.types[typeName],
      `type "${typeName}" missing from current snapshot`,
    );

    // Compare fields
    compareTypeFields(ctx, typeName, prevType, currType);

    // Compare indexes
    compareIndexes(ctx, typeName, prevType.indexes, currType.indexes);

    // Compare file fields
    compareFiles(ctx, typeName, prevType.files, currType.files);

    // Compare relationships
    compareRelationships(
      ctx,
      typeName,
      "forward",
      prevType.forwardRelationships,
      currType.forwardRelationships,
    );
    compareRelationships(
      ctx,
      typeName,
      "backward",
      prevType.backwardRelationships,
      currType.backwardRelationships,
    );

    // Compare permissions
    comparePermissions(
      ctx,
      typeName,
      prevType.permissions?.record,
      currType.permissions?.record,
      prevType.permissions?.gql,
      currType.permissions?.gql,
    );
  }

  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: current.namespace,
    createdAt: new Date().toISOString(),
    changes: ctx.changes,
    hasBreakingChanges: ctx.breakingChanges.length > 0,
    breakingChanges: ctx.breakingChanges,
    hasWarnings: ctx.warnings.length > 0,
    warnings: ctx.warnings,
    requiresMigrationScript: ctx.breakingChanges.length > 0,
  };
}

/**
 * Compare a snapshot against canonical TailorDBSnapshotType-shaped local types.
 * Callers are expected to pre-convert TailorDBService.types to TailorDBSnapshotType via
 * `createSnapshotType`. As a safety net, `compareSnapshots` re-runs idempotent
 * normalization on both sides, so a caller that forgets will still get correct
 * comparisons (no silent false drift).
 * @param {SchemaSnapshot} snapshot - Schema snapshot to compare against
 * @param {Record<string, TailorDBSnapshotType>} localTypes - Local snapshot-shaped types
 * @param {string} namespace - Namespace for comparison
 * @returns {MigrationDiff} Migration diff
 */
export function compareLocalTypesWithSnapshot(
  snapshot: SchemaSnapshot,
  localTypes: Record<string, TailorDBSnapshotType>,
  namespace: string,
): MigrationDiff {
  const currentSnapshot: SchemaSnapshot = {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace,
    createdAt: new Date().toISOString(),
    types: localTypes,
  };
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

// ============================================================================
// Remote Schema Verification
// ============================================================================

/**
 * Convert remote ParsedTailorDBType to SnapshotFieldConfig for comparison
 * @param {ProtoTailorDBType} remoteType - Remote TailorDB type from API
 * @returns {Record<string, SnapshotFieldConfig>} Converted field configs
 */
function convertRemoteFieldsToSnapshot(
  remoteType: ProtoTailorDBType,
): Record<string, SnapshotFieldConfig> {
  const fields = createSnapshotRecord<SnapshotFieldConfig>();
  const remoteFields = remoteType.schema?.fields ?? {};

  for (const [fieldName, remoteField] of Object.entries(remoteFields)) {
    const config: SnapshotFieldConfig = {
      type: remoteField.type,
      required: remoteField.required,
    };

    if (remoteField.array) config.array = true;
    if (remoteField.index) config.index = true;
    if (remoteField.unique) config.unique = true;
    if (remoteField.foreignKey) {
      config.foreignKey = true;
      if (remoteField.foreignKeyType) config.foreignKeyType = remoteField.foreignKeyType;
      if (remoteField.foreignKeyField) config.foreignKeyField = remoteField.foreignKeyField;
    }
    if (remoteField.allowedValues.length > 0) {
      config.allowedValues = remoteField.allowedValues.map((v) => ({
        value: v.value,
        ...(v.description && { description: v.description }),
      }));
    }

    if (remoteField.description) config.description = remoteField.description;
    if (remoteField.vector) config.vector = true;

    if (remoteField.hooks) {
      config.hooks = {};
      if (remoteField.hooks.create?.expr) {
        config.hooks.create = { expr: remoteField.hooks.create.expr };
      }
      if (remoteField.hooks.update?.expr) {
        config.hooks.update = { expr: remoteField.hooks.update.expr };
      }
    }

    if (remoteField.validate.length > 0) {
      config.validate = remoteField.validate.map((v) => ({
        script: { expr: v.script?.expr ?? "" },
        errorMessage: v.errorMessage ?? "",
      }));
    }

    if (remoteField.serial) {
      config.serial = {
        start: Number(remoteField.serial.start),
        ...(remoteField.serial.maxValue && { maxValue: Number(remoteField.serial.maxValue) }),
        ...(remoteField.serial.format && { format: remoteField.serial.format }),
      };
    }

    if (remoteField.scale !== undefined) config.scale = remoteField.scale;

    // TODO: Add nested field conversion when remote API supports it

    normalizeSnapshotField(config);
    fields[fieldName] = config;
  }

  return fields;
}

function convertRemoteTypeToSnapshot(remoteType: ProtoTailorDBType): TailorDBSnapshotType {
  const snapshotType: TailorDBSnapshotType = {
    name: remoteType.name,
    pluralForm: remoteType.schema?.settings?.pluralForm || inflection.pluralize(remoteType.name),
    fields: convertRemoteFieldsToSnapshot(remoteType),
  };

  if (remoteType.schema?.description) {
    snapshotType.description = remoteType.schema.description;
  }

  return normalizeSnapshotType(snapshotType);
}

/**
 * Convert remote TailorDB types into the normalized snapshot shape used by drift checks.
 * @param {ProtoTailorDBType[]} remoteTypes - Remote TailorDB types from the API
 * @param {string} namespace - Namespace for the reconstructed snapshot
 * @returns {NormalizedSchemaSnapshot} Normalized snapshot-shaped remote state
 */
export function createSnapshotFromRemoteTypes(
  remoteTypes: ProtoTailorDBType[],
  namespace: string,
): NormalizedSchemaSnapshot {
  const types = createSnapshotRecord<TailorDBSnapshotType>();
  for (const remoteType of remoteTypes) {
    types[remoteType.name] = convertRemoteTypeToSnapshot(remoteType);
  }

  return normalizeSchemaSnapshot({
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace,
    createdAt: new Date().toISOString(),
    types,
  });
}

/**
 * Compare a single field between remote and snapshot
 * @param {string} typeName - Name of the type
 * @param {string} fieldName - Name of the field
 * @param {SnapshotFieldConfig} remoteField - Remote field config
 * @param {SnapshotFieldConfig} snapshotField - Snapshot field config
 * @returns {SchemaDrift | null} Drift info or null if fields match
 */
function compareFields(
  typeName: string,
  fieldName: string,
  remoteField: SnapshotFieldConfig,
  snapshotField: SnapshotFieldConfig,
): SchemaDrift | null {
  const differences: string[] = [];

  // Compare type
  if (remoteField.type !== snapshotField.type) {
    differences.push(`type: remote=${remoteField.type}, expected=${snapshotField.type}`);
  }

  // Compare required
  if (remoteField.required !== snapshotField.required) {
    differences.push(
      `required: remote=${remoteField.required}, expected=${snapshotField.required}`,
    );
  }

  // Compare array
  const remoteArray = remoteField.array ?? false;
  const snapshotArray = snapshotField.array ?? false;
  if (remoteArray !== snapshotArray) {
    differences.push(`array: remote=${remoteArray}, expected=${snapshotArray}`);
  }

  // Compare unique
  const remoteUnique = remoteField.unique ?? false;
  const snapshotUnique = snapshotField.unique ?? false;
  if (remoteUnique !== snapshotUnique) {
    differences.push(`unique: remote=${remoteUnique}, expected=${snapshotUnique}`);
  }

  // Compare foreignKey
  const remoteFk = remoteField.foreignKey ?? false;
  const snapshotFk = snapshotField.foreignKey ?? false;
  if (remoteFk !== snapshotFk) {
    differences.push(`foreignKey: remote=${remoteFk}, expected=${snapshotFk}`);
  }

  // Compare foreignKeyType
  if (remoteField.foreignKeyType !== snapshotField.foreignKeyType) {
    differences.push(
      `foreignKeyType: remote=${remoteField.foreignKeyType ?? "none"}, expected=${snapshotField.foreignKeyType ?? "none"}`,
    );
  }

  const remoteAllowed = remoteField.allowedValues ?? [];
  const snapshotAllowed = snapshotField.allowedValues ?? [];
  const remoteAllowedValues = new Set(remoteAllowed.map((v) => v.value));
  const snapshotAllowedValues = new Set(snapshotAllowed.map((v) => v.value));
  if (remoteAllowedValues.size !== snapshotAllowedValues.size) {
    differences.push(
      `allowedValues count: remote=${remoteAllowedValues.size}, expected=${snapshotAllowedValues.size}`,
    );
  } else {
    for (const v of remoteAllowedValues) {
      if (!snapshotAllowedValues.has(v)) {
        differences.push(`allowedValues: remote has '${v}' not in snapshot`);
        break;
      }
    }
    for (const v of snapshotAllowedValues) {
      if (!remoteAllowedValues.has(v)) {
        differences.push(`allowedValues: snapshot has '${v}' not in remote`);
        break;
      }
    }
  }

  const remoteVector = remoteField.vector ?? false;
  const snapshotVector = snapshotField.vector ?? false;
  if (remoteVector !== snapshotVector) {
    differences.push(`vector: remote=${remoteVector}, expected=${snapshotVector}`);
  }

  if (remoteField.scale !== snapshotField.scale) {
    differences.push(`scale: remote=${remoteField.scale}, expected=${snapshotField.scale}`);
  }

  if (differences.length > 0) {
    return {
      typeName,
      kind: "field_mismatch",
      fieldName,
      details: differences.join("; "),
    };
  }

  return null;
}

/**
 * System fields that are auto-generated and should be excluded from comparison
 */
const SYSTEM_FIELDS = new Set(["id"]);

/**
 * Compare remote TailorDB types with a local snapshot
 * @param {ProtoTailorDBType[]} remoteTypes - Remote types from listParsedTailorDBTypes API
 * @param {SchemaSnapshot} snapshot - Local schema snapshot
 * @returns {SchemaDrift[]} List of drifts detected
 */
export function compareRemoteWithSnapshot(
  remoteTypes: ProtoTailorDBType[],
  snapshot: SchemaSnapshot,
): SchemaDrift[] {
  return compareNormalizedRemoteWithSnapshot(
    createSnapshotFromRemoteTypes(remoteTypes, snapshot.namespace),
    normalizeSchemaSnapshot(snapshot),
  );
}

function compareNormalizedRemoteWithSnapshot(
  remoteSnapshot: NormalizedSchemaSnapshot,
  snapshot: NormalizedSchemaSnapshot,
): SchemaDrift[] {
  const drifts: SchemaDrift[] = [];

  // Build maps for easy lookup
  const remoteTypeMap = new Map(Object.entries(remoteSnapshot.types));

  const snapshotTypeNames = new Set(Object.keys(snapshot.types));
  const remoteTypeNames = new Set(Object.keys(remoteSnapshot.types));

  // Check for types missing in remote
  for (const typeName of snapshotTypeNames) {
    if (!remoteTypeNames.has(typeName)) {
      drifts.push({
        typeName,
        kind: "type_missing_remote",
        details: `Type '${typeName}' exists in snapshot but not in remote`,
      });
    }
  }

  // Check for types missing in snapshot (unexpected types in remote)
  for (const typeName of remoteTypeNames) {
    if (!snapshotTypeNames.has(typeName)) {
      drifts.push({
        typeName,
        kind: "type_missing_local",
        details: `Type '${typeName}' exists in remote but not in snapshot`,
      });
    }
  }

  // Compare fields for types that exist in both
  for (const typeName of snapshotTypeNames) {
    if (!remoteTypeNames.has(typeName)) continue;

    const remoteType = assertDefined(
      remoteTypeMap.get(typeName),
      `type "${typeName}" missing from remoteTypeMap`,
    );
    const snapshotType = assertDefined(
      snapshot.types[typeName],
      `type "${typeName}" missing from snapshot`,
    );

    const remoteFields = remoteType.fields;
    const snapshotFields = snapshotType.fields;

    // Exclude system fields (like 'id') from comparison
    const remoteFieldNames = new Set(
      Object.keys(remoteFields).filter((f) => !SYSTEM_FIELDS.has(f)),
    );
    const snapshotFieldNames = new Set(
      Object.keys(snapshotFields).filter((f) => !SYSTEM_FIELDS.has(f)),
    );

    // Check for fields missing in remote
    for (const fieldName of snapshotFieldNames) {
      if (!remoteFieldNames.has(fieldName)) {
        drifts.push({
          typeName,
          kind: "field_missing_remote",
          fieldName,
          details: `Field '${fieldName}' exists in snapshot but not in remote`,
        });
      }
    }

    // Check for fields missing in snapshot
    for (const fieldName of remoteFieldNames) {
      if (!snapshotFieldNames.has(fieldName)) {
        drifts.push({
          typeName,
          kind: "field_missing_local",
          fieldName,
          details: `Field '${fieldName}' exists in remote but not in snapshot`,
        });
      }
    }

    // Compare fields that exist in both
    for (const fieldName of snapshotFieldNames) {
      if (!remoteFieldNames.has(fieldName)) continue;

      const drift = compareFields(
        typeName,
        fieldName,
        assertDefined(remoteFields[fieldName], `field "${fieldName}" missing from remoteFields`),
        assertDefined(
          snapshotFields[fieldName],
          `field "${fieldName}" missing from snapshotFields`,
        ),
      );
      if (drift) {
        drifts.push(drift);
      }
    }
  }

  return drifts;
}

/**
 * Format schema drifts for display
 * @param {SchemaDrift[]} drifts - List of drifts to format
 * @returns {string} Formatted drift report
 */
export function formatSchemaDrifts(drifts: SchemaDrift[]): string {
  if (drifts.length === 0) {
    return "No schema drifts detected.";
  }

  const lines: string[] = [];

  // Group drifts by type
  const driftsByType = new Map<string, SchemaDrift[]>();
  for (const drift of drifts) {
    const existing = driftsByType.get(drift.typeName) ?? [];
    existing.push(drift);
    driftsByType.set(drift.typeName, existing);
  }

  for (const [typeName, typeDrifts] of driftsByType) {
    lines.push(`  Type '${typeName}':`);
    for (const drift of typeDrifts) {
      if (drift.fieldName) {
        lines.push(`    - Field '${drift.fieldName}': ${drift.details}`);
      } else {
        lines.push(`    - ${drift.details}`);
      }
    }
  }

  return lines.join("\n");
}
