/**
 * Schema snapshot management for TailorDB migrations
 */

import * as fs from "node:fs";
import { toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  TailorDBGQLPermission_Action,
  TailorDBType_PermitAction,
  TailorDBType_Permission_Operator,
  TailorDBType_Permission_Permit,
  type TailorDBGQLPermission,
  type TailorDBGQLPermission_Condition,
  type TailorDBGQLPermission_Operand,
  type TailorDBGQLPermission_Operator,
  type TailorDBGQLPermission_Permit,
  type TailorDBType as ProtoTailorDBType,
  type TailorDBType_Permission,
  type TailorDBType_Permission_Condition,
  type TailorDBType_Permission_Operand,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import * as inflection from "inflection";
import * as path from "pathe";
import { z } from "zod";
import { assertDefined } from "#/utils/assert";
import {
  type MigrationDiff,
  type DiffChange,
  type FieldDiffChange,
  type BreakingChangeInfo,
  type SnapshotTypeSettingsState,
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
  SnapshotGqlOperations,
  SnapshotPermissionOperand,
  SnapshotPermissionOperator,
  SnapshotIndexConfig,
  SnapshotPermissionCondition,
  SnapshotRecordPermission,
  SnapshotRelationship,
  SnapshotSettings,
  TailorDBSnapshotType,
} from "./snapshot-types";
import type { SchemaDrift } from "./types";

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
 * Normalize a snapshot field into the canonical form for comparison, returning
 * a new object rather than mutating the input. Currently fills in the platform
 * default decimal scale when omitted, which avoids false drift between local
 * schemas (where scale may be omitted) and the platform (which always
 * materializes a scale).
 * @param {SnapshotFieldConfig} field - Field configuration to normalize
 * @returns {SnapshotFieldConfig} A new, normalized field object
 */
function normalizeSnapshotField(field: SnapshotFieldConfig): SnapshotFieldConfig {
  const fields = field.fields
    ? Object.fromEntries(
        Object.entries(field.fields).map(([name, nested]) => [
          name,
          normalizeSnapshotField(nested),
        ]),
      )
    : undefined;

  return {
    ...field,
    ...(field.type === "decimal" && field.scale === undefined && { scale: DEFAULT_DECIMAL_SCALE }),
    ...(fields && { fields }),
  };
}

/**
 * Normalize a snapshot type into the canonical comparison shape, returning a
 * new object rather than mutating the input. Currently fills:
 *   - `pluralForm` via inflection when missing (legacy snapshots written
 *     before `pluralForm` became required may omit it)
 *   - per-field `scale` defaults via {@link normalizeSnapshotField}
 *
 * Idempotent — safe to call multiple times on the same input.
 * @param {TailorDBSnapshotType} type - Snapshot type to normalize
 * @returns {TailorDBSnapshotType} A new, normalized snapshot type object
 */
function normalizeSnapshotType(type: TailorDBSnapshotType): TailorDBSnapshotType {
  // `pluralForm` is typed as required by TailorDBSnapshotType, but JSON.parse'd legacy
  // snapshots may have it undefined at runtime — backfill from inflection.
  const pluralForm =
    (type as { pluralForm?: string }).pluralForm || inflection.pluralize(type.name);
  const fields = createSnapshotRecord<SnapshotFieldConfig>();
  for (const [fieldName, field] of Object.entries(type.fields)) {
    fields[fieldName] = normalizeSnapshotField(field);
  }
  return { ...type, pluralForm, fields };
}

/**
 * Normalize a schema snapshot into the canonical comparison shape, returning a
 * new object rather than mutating the input.
 * @param {SchemaSnapshot} snapshot - Schema snapshot to normalize
 * @returns {NormalizedSchemaSnapshot} A new schema snapshot object branded as normalized
 */
export function normalizeSchemaSnapshot(snapshot: SchemaSnapshot): NormalizedSchemaSnapshot {
  const types = createSnapshotRecord<TailorDBSnapshotType>();
  for (const [typeName, type] of Object.entries(snapshot.types)) {
    types[typeName] = normalizeSnapshotType(type);
  }
  return { ...snapshot, types } as NormalizedSchemaSnapshot;
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
  SnapshotGqlOperations,
  SnapshotSettings,
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

  return normalizeSnapshotField(config);
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

  return normalizeSnapshotField(config);
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
      case "type_settings_modified": {
        const existing = types[change.typeName];
        if (existing) {
          types[change.typeName] = {
            ...existing,
            description: change.after.description,
            pluralForm: change.after.pluralForm,
            settings: change.after.settings ?? {},
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

      if (
        oldFieldsStr !== newFieldsStr ||
        (oldIndex.unique ?? false) !== (newIndex.unique ?? false)
      ) {
        const reasons: string[] = [];
        if (oldFieldsStr !== newFieldsStr) reasons.push("fields changed");
        if ((oldIndex.unique ?? false) !== (newIndex.unique ?? false))
          reasons.push("unique constraint changed");
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
      if (oldRel.description !== newRel.description) {
        reasons.push("description changed");
      }

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
  const oldComparableRecordPerm = comparableRecordPermission(oldRecordPerm);
  const newComparableRecordPerm = comparableRecordPermission(newRecordPerm);
  const oldRecordStr = JSON.stringify(oldComparableRecordPerm ?? null);
  const newRecordStr = JSON.stringify(newComparableRecordPerm ?? null);
  const recordPermChanged = oldRecordStr !== newRecordStr;

  // Compare GQL permissions
  const oldComparableGqlPerm = comparableGqlPermission(oldGqlPerm);
  const newComparableGqlPerm = comparableGqlPermission(newGqlPerm);
  const oldGqlStr = JSON.stringify(oldComparableGqlPerm ?? null);
  const newGqlStr = JSON.stringify(newComparableGqlPerm ?? null);
  const gqlPermChanged = oldGqlStr !== newGqlStr;

  if (recordPermChanged || gqlPermChanged) {
    const reasons: string[] = [];
    if (recordPermChanged) reasons.push("record permission");
    if (gqlPermChanged) reasons.push("GQL permission");

    ctx.changes.push({
      kind: "permission_modified",
      typeName,
      reason: `${reasons.join(" and ")} changed`,
      before: { recordPermission: oldComparableRecordPerm, gqlPermission: oldComparableGqlPerm },
      after: { recordPermission: newComparableRecordPerm, gqlPermission: newComparableGqlPerm },
    });
  }
}

const GQL_ACTION_ORDER: Record<SnapshotGqlAction, number> = {
  all: 0,
  create: 1,
  read: 2,
  update: 3,
  delete: 4,
  aggregate: 5,
  bulkUpsert: 6,
};

// Policies and conditions combine as an order-independent set on the platform,
// so canonicalize their order before comparison to avoid false drift when the
// remote returns them in a different order than the local snapshot declares.
function sortByJson<T>(items: readonly T[]): T[] {
  return items
    .map((item) => [JSON.stringify(item), item] as const)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, item]) => item);
}

function comparableGqlPermission(
  permission: SnapshotGqlPermission | undefined,
): SnapshotGqlPermission | undefined {
  const policies = permission?.map((policy) => ({
    ...policy,
    conditions: sortByJson(policy.conditions),
    actions: policy.actions.toSorted(
      (left, right) => GQL_ACTION_ORDER[left] - GQL_ACTION_ORDER[right],
    ),
  }));
  return policies && policies.length > 0 ? sortByJson(policies) : undefined;
}

function comparableRecordPermission(
  permission: SnapshotRecordPermission | undefined,
): SnapshotRecordPermission | undefined {
  if (!permission) return undefined;
  if (!Object.values(permission).some((policies) => policies.length > 0)) return undefined;

  const canonical: SnapshotRecordPermission = {
    create: sortByJson(permission.create.map(canonicalActionPermission)),
    read: sortByJson(permission.read.map(canonicalActionPermission)),
    update: sortByJson(permission.update.map(canonicalActionPermission)),
    delete: sortByJson(permission.delete.map(canonicalActionPermission)),
  };
  return canonical;
}

function canonicalActionPermission(policy: SnapshotActionPermission): SnapshotActionPermission {
  return { ...policy, conditions: sortByJson(policy.conditions) };
}

function normalizeComparableGqlOperations(
  operations: SnapshotGqlOperations | undefined,
): SnapshotGqlOperations | undefined {
  if (!operations) return undefined;

  return {
    create: operations.create ?? true,
    update: operations.update ?? true,
    delete: operations.delete ?? true,
    read: operations.read ?? true,
  };
}

function normalizeComparableSettings(
  settings: TailorDBSnapshotType["settings"],
): TailorDBSnapshotType["settings"] | undefined {
  const normalized: SnapshotSettings = {};

  if (settings?.aggregation === true) normalized.aggregation = true;
  if (settings?.bulkUpsert === true) normalized.bulkUpsert = true;
  if (settings?.publishEvents === true) normalized.publishEvents = true;

  const gqlOperations = normalizeComparableGqlOperations(settings?.gqlOperations);
  if (gqlOperations) normalized.gqlOperations = gqlOperations;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function typeSettingsState(
  description: string | undefined,
  pluralForm: string,
  settings: TailorDBSnapshotType["settings"],
): SnapshotTypeSettingsState {
  return {
    ...(description ? { description } : {}),
    pluralForm,
    ...(settings && { settings }),
  };
}

function comparableTypeSettings(type: TailorDBSnapshotType): SnapshotTypeSettingsState {
  return typeSettingsState(
    type.description,
    inflection.camelize(type.pluralForm, true),
    normalizeComparableSettings(type.settings),
  );
}

function snapshotTypeSettingsState(type: TailorDBSnapshotType): SnapshotTypeSettingsState {
  return typeSettingsState(type.description, type.pluralForm, type.settings ?? {});
}

function compareTypeSettings(
  ctx: DiffContext,
  typeName: string,
  previous: TailorDBSnapshotType,
  current: TailorDBSnapshotType,
): void {
  const previousComparable = comparableTypeSettings(previous);
  const currentComparable = comparableTypeSettings(current);

  if (JSON.stringify(previousComparable) === JSON.stringify(currentComparable)) return;

  ctx.changes.push({
    kind: "type_settings_modified",
    typeName,
    reason: "settings changed",
    before: snapshotTypeSettingsState(previous),
    after: snapshotTypeSettingsState(current),
  });
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

    // Compare type-level settings and metadata
    compareTypeSettings(ctx, typeName, prevType, currType);

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

export interface RemoteGqlPermission {
  typeName: string;
  permission?: TailorDBGQLPermission;
}

type RemoteFieldConfig = NonNullable<ProtoTailorDBType["schema"]>["fields"][string];
type RemoteRelationshipConfig = NonNullable<ProtoTailorDBType["schema"]>["relationships"][string];

function convertRemoteFieldToSnapshot(remoteField: RemoteFieldConfig): SnapshotFieldConfig {
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
  const allowedValues = remoteField.allowedValues;
  if (allowedValues.length > 0) {
    config.allowedValues = allowedValues.map((v) => ({
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

  const validate = remoteField.validate;
  if (validate.length > 0) {
    config.validate = validate.map((v) => ({
      script: { expr: convertRemoteValidateExpression(v.script?.expr ?? "", v.action) },
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

  const nestedFields = remoteField.fields;
  if (Object.keys(nestedFields).length > 0) {
    config.fields = createSnapshotRecord<SnapshotFieldConfig>();
    for (const [fieldName, nestedField] of Object.entries(nestedFields)) {
      config.fields[fieldName] = convertRemoteFieldToSnapshot(nestedField);
    }
  }

  return config;
}

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
    fields[fieldName] = convertRemoteFieldToSnapshot(remoteField);
  }

  return fields;
}

function convertRemoteValidateExpression(expr: string, action: TailorDBType_PermitAction): string {
  return action === TailorDBType_PermitAction.DENY && expr.startsWith("!") ? expr.slice(1) : expr;
}

function convertRemoteSettingsToSnapshot(
  remoteSettings: NonNullable<ProtoTailorDBType["schema"]>["settings"] | undefined,
  expectedSettings?: TailorDBSnapshotType["settings"],
): TailorDBSnapshotType["settings"] | undefined {
  const settings: SnapshotSettings = {};

  if (remoteSettings?.aggregation) settings.aggregation = true;
  if (remoteSettings?.bulkUpsert) settings.bulkUpsert = true;
  if (remoteSettings?.publishRecordEvents) settings.publishEvents = true;

  const disabled = remoteSettings?.disableGqlOperations;
  if (disabled) {
    const hasDisabledOperation =
      disabled.create || disabled.update || disabled.delete || disabled.read;
    if (expectedSettings?.gqlOperations !== undefined || hasDisabledOperation) {
      settings.gqlOperations = {
        create: !disabled.create,
        update: !disabled.update,
        delete: !disabled.delete,
        read: !disabled.read,
      };
    }
  }

  return Object.keys(settings).length > 0 ? settings : undefined;
}

function convertRemoteIndexesToSnapshot(
  remoteIndexes: NonNullable<ProtoTailorDBType["schema"]>["indexes"] | undefined,
): Record<string, SnapshotIndexConfig> | undefined {
  const indexes = createSnapshotRecord<SnapshotIndexConfig>();
  for (const [indexName, indexConfig] of Object.entries(remoteIndexes ?? {})) {
    indexes[indexName] = {
      fields: indexConfig.fieldNames,
      ...(indexConfig.unique && { unique: true }),
    };
  }
  return Object.keys(indexes).length > 0 ? indexes : undefined;
}

function convertRemoteFilesToSnapshot(
  remoteFiles: NonNullable<ProtoTailorDBType["schema"]>["files"] | undefined,
): Record<string, string> | undefined {
  const files = createSnapshotRecord<string>();
  for (const [fileName, fileConfig] of Object.entries(remoteFiles ?? {})) {
    files[fileName] = fileConfig.description || "";
  }
  return Object.keys(files).length > 0 ? files : undefined;
}

function convertRemoteRelationshipToSnapshot(
  relationship: RemoteRelationshipConfig,
  direction: "forward" | "backward",
): SnapshotRelationship {
  return direction === "forward"
    ? {
        targetType: relationship.refType,
        targetField: relationship.srcField,
        sourceField: relationship.refField,
        isArray: relationship.array,
        description: relationship.description || "",
      }
    : {
        targetType: relationship.refType,
        targetField: relationship.refField,
        sourceField: relationship.srcField,
        isArray: relationship.array,
        description: relationship.description || "",
      };
}

function remoteRelationshipMatchesExpectedDirection(
  relationship: RemoteRelationshipConfig,
  expected: SnapshotRelationship,
  direction: "forward" | "backward",
): boolean {
  const converted = convertRemoteRelationshipToSnapshot(relationship, direction);
  return (
    converted.targetType === expected.targetType &&
    converted.targetField === expected.targetField &&
    converted.sourceField === expected.sourceField &&
    converted.isArray === expected.isArray
  );
}

function inferRemoteRelationshipDirection(
  relationshipName: string,
  relationship: RemoteRelationshipConfig,
  expectedType: TailorDBSnapshotType | undefined,
): "forward" | "backward" {
  const expectedForward = expectedType?.forwardRelationships?.[relationshipName];
  const expectedBackward = expectedType?.backwardRelationships?.[relationshipName];

  if (expectedForward && !expectedBackward) return "forward";
  if (expectedBackward && !expectedForward) return "backward";
  if (
    expectedForward &&
    remoteRelationshipMatchesExpectedDirection(relationship, expectedForward, "forward")
  ) {
    return "forward";
  }
  if (
    expectedBackward &&
    remoteRelationshipMatchesExpectedDirection(relationship, expectedBackward, "backward")
  ) {
    return "backward";
  }

  return relationship.array ? "backward" : "forward";
}

function convertRemoteRelationshipsToSnapshot(
  remoteRelationships: NonNullable<ProtoTailorDBType["schema"]>["relationships"] | undefined,
  expectedType?: TailorDBSnapshotType,
): Pick<TailorDBSnapshotType, "forwardRelationships" | "backwardRelationships"> {
  const forwardRelationships = createSnapshotRecord<SnapshotRelationship>();
  const backwardRelationships = createSnapshotRecord<SnapshotRelationship>();

  for (const [relationshipName, relationship] of Object.entries(remoteRelationships ?? {})) {
    const direction = inferRemoteRelationshipDirection(
      relationshipName,
      relationship,
      expectedType,
    );
    if (direction === "forward") {
      forwardRelationships[relationshipName] = convertRemoteRelationshipToSnapshot(
        relationship,
        direction,
      );
    } else {
      backwardRelationships[relationshipName] = convertRemoteRelationshipToSnapshot(
        relationship,
        direction,
      );
    }
  }

  return {
    ...(Object.keys(forwardRelationships).length > 0 && { forwardRelationships }),
    ...(Object.keys(backwardRelationships).length > 0 && { backwardRelationships }),
  };
}

type RemoteRecordPolicy = NonNullable<TailorDBType_Permission>["create"][number];

type RemotePermissionPermit = TailorDBType_Permission_Permit | TailorDBGQLPermission_Permit;
type RemotePermissionOperator = TailorDBType_Permission_Operator | TailorDBGQLPermission_Operator;
type PermissionSource = "record" | "GQL";

// TailorDBType_Permission_Permit and TailorDBGQLPermission_Permit share identical numeric values.
const REMOTE_PERMISSION_PERMITS = new Map<number, "allow" | "deny">([
  [TailorDBType_Permission_Permit.ALLOW, "allow"],
  [TailorDBType_Permission_Permit.DENY, "deny"],
]);

// TailorDBType_Permission_Operator and TailorDBGQLPermission_Operator share identical numeric values.
const REMOTE_PERMISSION_OPERATORS = new Map<number, SnapshotPermissionOperator>([
  [TailorDBType_Permission_Operator.EQ, "eq"],
  [TailorDBType_Permission_Operator.NE, "ne"],
  [TailorDBType_Permission_Operator.IN, "in"],
  [TailorDBType_Permission_Operator.NIN, "nin"],
  [TailorDBType_Permission_Operator.HAS_ANY, "hasAny"],
  [TailorDBType_Permission_Operator.NHAS_ANY, "nhasAny"],
]);

function convertRemotePermit(
  permit: RemotePermissionPermit,
  source: PermissionSource,
): "allow" | "deny" {
  const converted = REMOTE_PERMISSION_PERMITS.get(permit);
  if (converted) return converted;
  throw new Error(`Unsupported ${source} permission permit: ${permit}`);
}

function convertRemoteOperator(
  operator: RemotePermissionOperator,
  source: PermissionSource,
): SnapshotPermissionOperator {
  const converted = REMOTE_PERMISSION_OPERATORS.get(operator);
  if (converted) return converted;
  throw new Error(`Unsupported ${source} permission operator: ${operator}`);
}

function convertRemoteValueOperand(
  operand: TailorDBType_Permission_Operand | TailorDBGQLPermission_Operand | undefined,
): SnapshotPermissionOperand {
  switch (operand?.kind.case) {
    case "userField":
      return { user: operand.kind.value };
    case "recordField":
      return { record: operand.kind.value };
    case "oldRecordField":
      return { oldRecord: operand.kind.value };
    case "newRecordField":
      return { newRecord: operand.kind.value };
    case "value":
      return toJson(ValueSchema, operand.kind.value) as SnapshotPermissionOperand;
    default:
      throw new Error("Unsupported permission operand");
  }
}

function convertRemoteRecordCondition(
  condition: TailorDBType_Permission_Condition,
): SnapshotPermissionCondition {
  return [
    convertRemoteValueOperand(condition.left),
    convertRemoteOperator(condition.operator, "record"),
    convertRemoteValueOperand(condition.right),
  ];
}

function convertRemoteGqlCondition(
  condition: TailorDBGQLPermission_Condition,
): SnapshotPermissionCondition {
  return [
    convertRemoteValueOperand(condition.left),
    convertRemoteOperator(condition.operator, "GQL"),
    convertRemoteValueOperand(condition.right),
  ];
}

function convertRemoteRecordPolicy(policy: RemoteRecordPolicy): SnapshotActionPermission {
  return {
    conditions: policy.conditions.map(convertRemoteRecordCondition),
    permit: convertRemotePermit(policy.permit, "record"),
    ...(policy.description && { description: policy.description }),
  };
}

function convertRemoteRecordPermissionToSnapshot(
  permission: TailorDBType_Permission | undefined,
): SnapshotRecordPermission | undefined {
  const recordPermission: SnapshotRecordPermission = {
    create: permission?.create.map(convertRemoteRecordPolicy) ?? [],
    read: permission?.read.map(convertRemoteRecordPolicy) ?? [],
    update: permission?.update.map(convertRemoteRecordPolicy) ?? [],
    delete: permission?.delete.map(convertRemoteRecordPolicy) ?? [],
  };

  return Object.values(recordPermission).some((policies) => policies.length > 0)
    ? recordPermission
    : undefined;
}

function convertRemoteGqlAction(action: TailorDBGQLPermission_Action): SnapshotGqlAction {
  switch (action) {
    case TailorDBGQLPermission_Action.ALL:
      return "all";
    case TailorDBGQLPermission_Action.CREATE:
      return "create";
    case TailorDBGQLPermission_Action.READ:
      return "read";
    case TailorDBGQLPermission_Action.UPDATE:
      return "update";
    case TailorDBGQLPermission_Action.DELETE:
      return "delete";
    case TailorDBGQLPermission_Action.AGGREGATE:
      return "aggregate";
    case TailorDBGQLPermission_Action.BULK_UPSERT:
      return "bulkUpsert";
    default:
      throw new Error(`Unsupported GQL permission action: ${action}`);
  }
}

function convertRemoteGqlPermissionToSnapshot(
  permission: TailorDBGQLPermission | undefined,
): SnapshotGqlPermission | undefined {
  const policies =
    permission?.policies.map((policy) => ({
      conditions: policy.conditions.map(convertRemoteGqlCondition),
      actions: policy.actions.map(convertRemoteGqlAction),
      permit: convertRemotePermit(policy.permit, "GQL"),
      ...(policy.description && { description: policy.description }),
    })) ?? [];

  return policies.length > 0 ? policies : undefined;
}

function convertRemoteTypeToSnapshot(
  remoteType: ProtoTailorDBType,
  expectedType?: TailorDBSnapshotType,
): TailorDBSnapshotType {
  const settings = convertRemoteSettingsToSnapshot(
    remoteType.schema?.settings,
    expectedType?.settings,
  );
  const relationships = convertRemoteRelationshipsToSnapshot(
    remoteType.schema?.relationships,
    expectedType,
  );
  const recordPermission = convertRemoteRecordPermissionToSnapshot(remoteType.schema?.permission);
  const snapshotType: TailorDBSnapshotType = {
    name: remoteType.name,
    pluralForm: remoteType.schema?.settings?.pluralForm || inflection.pluralize(remoteType.name),
    fields: convertRemoteFieldsToSnapshot(remoteType),
    ...(settings && { settings }),
    ...relationships,
  };

  if (remoteType.schema?.description) {
    snapshotType.description = remoteType.schema.description;
  }
  const indexes = convertRemoteIndexesToSnapshot(remoteType.schema?.indexes);
  if (indexes) snapshotType.indexes = indexes;

  const files = convertRemoteFilesToSnapshot(remoteType.schema?.files);
  if (files) snapshotType.files = files;

  if (recordPermission) {
    snapshotType.permissions = { record: recordPermission };
  }

  return snapshotType;
}

/**
 * Convert remote TailorDB types into the normalized snapshot shape used by drift checks.
 * @param {ProtoTailorDBType[]} remoteTypes - Remote TailorDB types from the API
 * @param {string} namespace - Namespace for the reconstructed snapshot
 * @param {readonly RemoteGqlPermission[]} remoteGqlPermissions - Remote GQL permissions for the namespace
 * @param {SchemaSnapshot} expectedSnapshot - Optional snapshot used to disambiguate remote relationship direction
 * @returns {NormalizedSchemaSnapshot} Normalized snapshot-shaped remote state
 */
export function createSnapshotFromRemoteTypes(
  remoteTypes: ProtoTailorDBType[],
  namespace: string,
  remoteGqlPermissions: readonly RemoteGqlPermission[] = [],
  expectedSnapshot?: SchemaSnapshot,
): NormalizedSchemaSnapshot {
  const types = createSnapshotRecord<TailorDBSnapshotType>();
  for (const remoteType of remoteTypes) {
    types[remoteType.name] = convertRemoteTypeToSnapshot(
      remoteType,
      expectedSnapshot?.types[remoteType.name],
    );
  }

  for (const permission of remoteGqlPermissions) {
    const { typeName } = permission;
    const snapshotType = types[typeName];
    if (!snapshotType) continue;

    const gqlPermission = convertRemoteGqlPermissionToSnapshot(permission.permission);
    if (!gqlPermission) continue;

    snapshotType.permissions = {
      ...snapshotType.permissions,
      gql: gqlPermission,
    };
  }

  return normalizeSchemaSnapshot({
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace,
    createdAt: new Date().toISOString(),
    types,
  });
}

function fieldDifferenceValue(value: unknown): string {
  if (value === undefined || value === "") return "none";
  return String(value);
}

function fieldDifferenceKey(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

function addFieldDifference(
  differences: string[],
  prefix: string,
  key: string,
  remoteValue: unknown,
  snapshotValue: unknown,
): void {
  if (remoteValue === snapshotValue) return;
  differences.push(
    `${fieldDifferenceKey(prefix, key)}: remote=${fieldDifferenceValue(
      remoteValue,
    )}, expected=${fieldDifferenceValue(snapshotValue)}`,
  );
}

function addBooleanFieldDifference(
  differences: string[],
  prefix: string,
  key: keyof SnapshotFieldConfig,
  remoteField: SnapshotFieldConfig,
  snapshotField: SnapshotFieldConfig,
): void {
  addFieldDifference(
    differences,
    prefix,
    key,
    remoteField[key] ?? false,
    snapshotField[key] ?? false,
  );
}

function addAllowedValuesDifferences(
  differences: string[],
  prefix: string,
  remoteField: SnapshotFieldConfig,
  snapshotField: SnapshotFieldConfig,
): void {
  const remoteAllowed = remoteField.allowedValues ?? [];
  const snapshotAllowed = snapshotField.allowedValues ?? [];
  if (remoteAllowed.length !== snapshotAllowed.length) {
    differences.push(
      `${fieldDifferenceKey(prefix, "allowedValues")} count: remote=${remoteAllowed.length}, expected=${snapshotAllowed.length}`,
    );
    return;
  }

  const snapshotAllowedValues = new Map(snapshotAllowed.map((v) => [v.value, v.description]));
  for (const value of remoteAllowed) {
    if (!snapshotAllowedValues.has(value.value)) {
      differences.push(
        `${fieldDifferenceKey(prefix, "allowedValues")}: remote has '${value.value}' not in snapshot`,
      );
      return;
    }
    const snapshotDescription = snapshotAllowedValues.get(value.value);
    if ((value.description ?? "") !== (snapshotDescription ?? "")) {
      addFieldDifference(
        differences,
        prefix,
        `allowedValues.${value.value}.description`,
        value.description ?? "",
        snapshotDescription ?? "",
      );
      return;
    }
  }

  const remoteAllowedValues = new Set(remoteAllowed.map((v) => v.value));
  for (const value of snapshotAllowed) {
    if (!remoteAllowedValues.has(value.value)) {
      differences.push(
        `${fieldDifferenceKey(prefix, "allowedValues")}: snapshot has '${value.value}' not in remote`,
      );
      return;
    }
  }
}

function addHooksDifferences(
  differences: string[],
  prefix: string,
  remoteField: SnapshotFieldConfig,
  snapshotField: SnapshotFieldConfig,
): void {
  addFieldDifference(
    differences,
    prefix,
    "hooks.create",
    remoteField.hooks?.create?.expr ?? "",
    snapshotField.hooks?.create?.expr ?? "",
  );
  addFieldDifference(
    differences,
    prefix,
    "hooks.update",
    remoteField.hooks?.update?.expr ?? "",
    snapshotField.hooks?.update?.expr ?? "",
  );
}

function addValidationDifferences(
  differences: string[],
  prefix: string,
  remoteField: SnapshotFieldConfig,
  snapshotField: SnapshotFieldConfig,
): void {
  const remoteValidate = remoteField.validate ?? [];
  const snapshotValidate = snapshotField.validate ?? [];
  if (remoteValidate.length !== snapshotValidate.length) {
    differences.push(
      `${fieldDifferenceKey(prefix, "validate")} count: remote=${remoteValidate.length}, expected=${snapshotValidate.length}`,
    );
  }

  const commonLength = Math.min(remoteValidate.length, snapshotValidate.length);
  for (let index = 0; index < commonLength; index++) {
    const remoteValidation = assertDefined(
      remoteValidate[index],
      `remoteValidate missing index ${index}`,
    );
    const snapshotValidation = assertDefined(
      snapshotValidate[index],
      `snapshotValidate missing index ${index}`,
    );
    addFieldDifference(
      differences,
      prefix,
      `validate[${index}].script`,
      remoteValidation.script?.expr ?? "",
      snapshotValidation.script?.expr ?? "",
    );
    addFieldDifference(
      differences,
      prefix,
      `validate[${index}].errorMessage`,
      remoteValidation.errorMessage,
      snapshotValidation.errorMessage,
    );
  }
}

function addSerialDifferences(
  differences: string[],
  prefix: string,
  remoteField: SnapshotFieldConfig,
  snapshotField: SnapshotFieldConfig,
): void {
  addFieldDifference(
    differences,
    prefix,
    "serial.start",
    remoteField.serial?.start,
    snapshotField.serial?.start,
  );
  addFieldDifference(
    differences,
    prefix,
    "serial.maxValue",
    remoteField.serial?.maxValue,
    snapshotField.serial?.maxValue,
  );
  addFieldDifference(
    differences,
    prefix,
    "serial.format",
    remoteField.serial?.format ?? "",
    snapshotField.serial?.format ?? "",
  );
}

function addNestedFieldDifferences(
  differences: string[],
  prefix: string,
  remoteField: SnapshotFieldConfig,
  snapshotField: SnapshotFieldConfig,
): void {
  const remoteFields = remoteField.fields ?? {};
  const snapshotFields = snapshotField.fields ?? {};
  const remoteFieldNames = Object.keys(remoteFields);
  const snapshotFieldNames = Object.keys(snapshotFields);

  if (remoteFieldNames.length !== snapshotFieldNames.length) {
    differences.push(
      `${fieldDifferenceKey(prefix, "fields")} count: remote=${remoteFieldNames.length}, expected=${snapshotFieldNames.length}`,
    );
  }

  for (const fieldName of remoteFieldNames) {
    const remoteNestedField = remoteFields[fieldName];
    const snapshotNestedField = snapshotFields[fieldName];
    const nestedPrefix = fieldDifferenceKey(prefix, `fields.${fieldName}`);
    if (!snapshotNestedField) {
      differences.push(`${nestedPrefix}: exists in remote but not snapshot`);
      continue;
    }
    addFieldDifferences(
      differences,
      nestedPrefix,
      assertDefined(remoteNestedField, `remote field "${fieldName}" missing`),
      snapshotNestedField,
    );
  }

  for (const fieldName of snapshotFieldNames) {
    if (remoteFields[fieldName]) continue;
    differences.push(
      `${fieldDifferenceKey(prefix, `fields.${fieldName}`)}: exists in snapshot but not remote`,
    );
  }
}

function addFieldDifferences(
  differences: string[],
  prefix: string,
  remoteField: SnapshotFieldConfig,
  snapshotField: SnapshotFieldConfig,
): void {
  addFieldDifference(differences, prefix, "type", remoteField.type, snapshotField.type);
  addFieldDifference(differences, prefix, "required", remoteField.required, snapshotField.required);

  for (const key of ["array", "index", "unique", "foreignKey", "vector"] as const) {
    addBooleanFieldDifference(differences, prefix, key, remoteField, snapshotField);
  }

  addFieldDifference(
    differences,
    prefix,
    "foreignKeyType",
    remoteField.foreignKeyType,
    snapshotField.foreignKeyType,
  );
  addFieldDifference(
    differences,
    prefix,
    "foreignKeyField",
    remoteField.foreignKeyField,
    snapshotField.foreignKeyField,
  );
  addFieldDifference(
    differences,
    prefix,
    "description",
    remoteField.description ?? "",
    snapshotField.description ?? "",
  );
  addAllowedValuesDifferences(differences, prefix, remoteField, snapshotField);
  addHooksDifferences(differences, prefix, remoteField, snapshotField);
  addValidationDifferences(differences, prefix, remoteField, snapshotField);
  addSerialDifferences(differences, prefix, remoteField, snapshotField);
  addFieldDifference(differences, prefix, "scale", remoteField.scale, snapshotField.scale);
  addNestedFieldDifferences(differences, prefix, remoteField, snapshotField);
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
  addFieldDifferences(differences, "", remoteField, snapshotField);

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
 * @param {readonly RemoteGqlPermission[]} remoteGqlPermissions - Remote GQL permissions for the namespace
 * @returns {SchemaDrift[]} List of drifts detected
 */
export function compareRemoteWithSnapshot(
  remoteTypes: ProtoTailorDBType[],
  snapshot: SchemaSnapshot,
  remoteGqlPermissions: readonly RemoteGqlPermission[] = [],
): SchemaDrift[] {
  return compareNormalizedRemoteWithSnapshot(
    createRemoteComparableSnapshot(
      createSnapshotFromRemoteTypes(
        remoteTypes,
        snapshot.namespace,
        remoteGqlPermissions,
        snapshot,
      ),
    ),
    createRemoteComparableSnapshot(snapshot),
  );
}

function createRemoteComparableSnapshot(snapshot: SchemaSnapshot): NormalizedSchemaSnapshot {
  const types = createSnapshotRecord<TailorDBSnapshotType>();

  for (const [typeName, type] of Object.entries(snapshot.types)) {
    const fields = createSnapshotRecord<SnapshotFieldConfig>();
    for (const [fieldName, field] of Object.entries(type.fields)) {
      if (SYSTEM_FIELDS.has(fieldName)) continue;
      fields[fieldName] = field;
    }
    types[typeName] = { ...type, fields };
  }

  return normalizeSchemaSnapshot({
    ...snapshot,
    types,
  });
}

function fieldDriftFromChange(
  change: Extract<DiffChange, { kind: "field_modified" }>,
): SchemaDrift {
  return (
    compareFields(change.typeName, change.fieldName, change.before, change.after) ?? {
      typeName: change.typeName,
      kind: "field_mismatch",
      fieldName: change.fieldName,
      details: `Field '${change.fieldName}' differs between remote and snapshot`,
    }
  );
}

function schemaDriftFromDiffChange(change: DiffChange): SchemaDrift {
  switch (change.kind) {
    case "type_added":
      return {
        typeName: change.typeName,
        kind: "type_missing_remote",
        details: `Type '${change.typeName}' exists in snapshot but not in remote`,
      };
    case "type_removed":
      return {
        typeName: change.typeName,
        kind: "type_missing_local",
        details: `Type '${change.typeName}' exists in remote but not in snapshot`,
      };
    case "type_settings_modified":
    case "type_modified":
      return {
        typeName: change.typeName,
        kind: "type_settings_mismatch",
        details: change.reason ?? "Type settings differ between remote and snapshot",
      };
    case "field_added":
      return {
        typeName: change.typeName,
        kind: "field_missing_remote",
        fieldName: change.fieldName,
        details: `Field '${change.fieldName}' exists in snapshot but not in remote`,
      };
    case "field_removed":
      return {
        typeName: change.typeName,
        kind: "field_missing_local",
        fieldName: change.fieldName,
        details: `Field '${change.fieldName}' exists in remote but not in snapshot`,
      };
    case "field_modified":
      return fieldDriftFromChange(change);
    case "index_added":
      return {
        typeName: change.typeName,
        kind: "index_missing_remote",
        indexName: change.indexName,
        details: `Index '${change.indexName}' exists in snapshot but not in remote`,
      };
    case "index_removed":
      return {
        typeName: change.typeName,
        kind: "index_missing_local",
        indexName: change.indexName,
        details: `Index '${change.indexName}' exists in remote but not in snapshot`,
      };
    case "index_modified":
      return {
        typeName: change.typeName,
        kind: "index_mismatch",
        indexName: change.indexName,
        details: change.reason ?? `Index '${change.indexName}' differs between remote and snapshot`,
      };
    case "file_added":
      return {
        typeName: change.typeName,
        kind: "file_missing_remote",
        fileName: change.fieldName,
        details: `File '${change.fieldName}' exists in snapshot but not in remote`,
      };
    case "file_removed":
      return {
        typeName: change.typeName,
        kind: "file_missing_local",
        fileName: change.fieldName,
        details: `File '${change.fieldName}' exists in remote but not in snapshot`,
      };
    case "file_modified":
      return {
        typeName: change.typeName,
        kind: "file_mismatch",
        fileName: change.fieldName,
        details: change.reason ?? `File '${change.fieldName}' differs between remote and snapshot`,
      };
    case "relationship_added":
      return {
        typeName: change.typeName,
        kind: "relationship_missing_remote",
        relationshipName: change.relationshipName,
        relationshipType: change.relationshipType,
        details: `Relationship '${change.relationshipName}' exists in snapshot but not in remote`,
      };
    case "relationship_removed":
      return {
        typeName: change.typeName,
        kind: "relationship_missing_local",
        relationshipName: change.relationshipName,
        relationshipType: change.relationshipType,
        details: `Relationship '${change.relationshipName}' exists in remote but not in snapshot`,
      };
    case "relationship_modified":
      return {
        typeName: change.typeName,
        kind: "relationship_mismatch",
        relationshipName: change.relationshipName,
        relationshipType: change.relationshipType,
        details:
          change.reason ??
          `Relationship '${change.relationshipName}' differs between remote and snapshot`,
      };
    case "permission_modified":
      return {
        typeName: change.typeName,
        kind: "permission_mismatch",
        details: change.reason ?? "Permissions differ between remote and snapshot",
      };
    default: {
      change satisfies never;
      throw new Error("Unsupported diff change");
    }
  }
}

function compareNormalizedRemoteWithSnapshot(
  remoteSnapshot: NormalizedSchemaSnapshot,
  snapshot: NormalizedSchemaSnapshot,
): SchemaDrift[] {
  return compareNormalizedSnapshots(remoteSnapshot, snapshot).changes.map(
    schemaDriftFromDiffChange,
  );
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
      } else if (drift.indexName) {
        lines.push(`    - Index '${drift.indexName}': ${drift.details}`);
      } else if (drift.fileName) {
        lines.push(`    - File '${drift.fileName}': ${drift.details}`);
      } else if (drift.relationshipName) {
        const relationshipType = drift.relationshipType ? ` (${drift.relationshipType})` : "";
        lines.push(
          `    - Relationship${relationshipType} '${drift.relationshipName}': ${drift.details}`,
        );
      } else {
        lines.push(`    - ${drift.details}`);
      }
    }
  }

  return lines.join("\n");
}
