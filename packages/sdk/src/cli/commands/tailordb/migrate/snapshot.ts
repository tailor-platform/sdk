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
import {
  computeSourceScriptHash,
  extractSourceScriptHash,
} from "#/parser/service/tailordb/type-script";
import { assertDefined } from "#/utils/assert";
import {
  type MigrationDiff,
  type DiffChange,
  type DiffChangeKind,
  type FieldDiffChange,
  type BreakingChangeInfo,
  type SnapshotTypeSettingsState,
  type TypeScriptsState,
  type WarningChangeInfo,
  MIN_SUPPORTED_MIGRATION_FILE_VERSION,
  SCHEMA_SNAPSHOT_VERSION,
} from "./diff-calculator";
import { supportsInPlaceFieldTypeChange } from "./field-type-change";
import { formatMigrationNumber } from "./migration-number";
import {
  assertValidFieldRenames,
  assertValidTypeRenames,
  isBreakingForeignKeyRetarget,
  type FieldRenameSpec,
  type TypeRenameSpec,
} from "./rename-detection";
import { schemaSnapshotSchema, migrationDiffSchema } from "./snapshot-schema";
import {
  SNAPSHOT_FIELD_BOOLEAN_PROPS,
  type NormalizedSchemaSnapshot,
  type SchemaSnapshot,
  type SnapshotActionPermission,
  type SnapshotFieldConfig,
  type SnapshotGqlAction,
  type SnapshotGqlPermission,
  type SnapshotGqlOperations,
  type SnapshotPermissionOperand,
  type SnapshotPermissionOperator,
  type SnapshotIndexConfig,
  type SnapshotPermissionCondition,
  type SnapshotRecordPermission,
  type SnapshotRelationship,
  type SnapshotSettings,
  type TailorDBSnapshotType,
} from "./snapshot-types";
import type {
  TailorDBType,
  OperatorFieldConfig,
  StandardActionPermission,
} from "#/parser/service/tailordb/types";
import type { ExpandContractPlan } from "./expand-contract";
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
 * Platform default scale for decimal fields when scale is not explicitly specified.
 * Must stay in sync with the platform's default decimal scale.
 */
export const DEFAULT_DECIMAL_SCALE = 6;

export class UnsupportedMigrationFileVersionError extends Error {}

function assertSupportedMigrationFileVersion(filePath: string, raw: unknown): void {
  if (typeof raw !== "object" || raw === null || !("version" in raw)) return;
  const version = raw.version;
  if (typeof version !== "number") return;
  if (
    Number.isInteger(version) &&
    version >= MIN_SUPPORTED_MIGRATION_FILE_VERSION &&
    version <= SCHEMA_SNAPSHOT_VERSION
  ) {
    return;
  }

  const supportedRange = `${MIN_SUPPORTED_MIGRATION_FILE_VERSION}-${SCHEMA_SNAPSHOT_VERSION}`;
  let guidance: string;
  if (version > SCHEMA_SNAPSHOT_VERSION) {
    guidance = `Upgrade to an SDK that supports migration file format version ${version}.`;
  } else if (version < MIN_SUPPORTED_MIGRATION_FILE_VERSION) {
    guidance =
      "Re-baseline with an SDK that still supports this migration history, then upgrade the SDK.";
  } else {
    guidance = "Restore the migration file from version control or regenerate it.";
  }
  throw new UnsupportedMigrationFileVersionError(
    `Unsupported migration file format version ${version} at ${filePath}. ` +
      `This SDK supports migration file format versions ${supportedRange}. ${guidance}`,
  );
}

/**
 * Diff change kinds renamed when TailorDB table terminology replaced "type".
 * Migration histories written before the rename persist the old names, so
 * diff.json files keep being read through this mapping.
 */
const LEGACY_CHANGE_KINDS = new Map<string, DiffChangeKind>([
  ["type_added", "table_added"],
  ["type_removed", "table_removed"],
  ["type_renamed", "table_renamed"],
  ["type_modified", "table_modified"],
  ["type_settings_modified", "table_settings_modified"],
  ["type_scripts_modified", "table_scripts_modified"],
]);

/**
 * Rewrite pre-rename `type_*` change kinds to their current `table_*` names
 * so that the diff schema, which only knows the current names, accepts them.
 * @param {unknown} raw - Parsed diff.json contents
 * @returns {unknown} Diff contents with legacy change kinds rewritten
 */
function normalizeLegacyChangeKinds(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !("changes" in raw)) return raw;
  const changes = (raw as { changes: unknown }).changes;
  if (!Array.isArray(changes)) return raw;

  const normalized = changes.map((change) => {
    if (typeof change !== "object" || change === null || !("kind" in change)) return change;
    const kind = (change as { kind: unknown }).kind;
    if (typeof kind !== "string") return change;
    const currentKind = LEGACY_CHANGE_KINDS.get(kind);
    return currentKind === undefined ? change : { ...change, kind: currentKind };
  });

  return { ...raw, changes: normalized };
}

/**
 * Persisted field names renamed when TailorDB table terminology replaced
 * "type". Applied to every entry that carries a table name, so diff.json files
 * written before the rename keep validating against the current schema.
 */
const LEGACY_ENTRY_FIELDS = new Map<string, string>([
  ["typeName", "tableName"],
  ["previousTypeName", "previousTableName"],
]);

function renameLegacyEntryFields(entry: unknown): unknown {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
  const source = entry as Record<string, unknown>;
  const renamed: Record<string, unknown> = {};
  let changed = false;
  for (const [key, value] of Object.entries(source)) {
    const currentKey = LEGACY_ENTRY_FIELDS.get(key);
    if (currentKey !== undefined && !(currentKey in source)) {
      renamed[currentKey] = value;
      changed = true;
    } else {
      renamed[key] = value;
    }
  }
  return changed ? renamed : entry;
}

/** Persisted arrays whose entries carry a table name. */
const LEGACY_FIELD_CARRIERS = ["changes", "breakingChanges", "warnings"] as const;

/**
 * Move a pre-rename `types` record to `tables` so schema.json files written
 * before the rename keep validating against the current schema.
 * @param {unknown} raw - Parsed schema.json contents
 * @returns {unknown} Snapshot contents with the legacy key moved
 */
function normalizeLegacyTablesKey(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const source = raw as Record<string, unknown>;
  if (!("types" in source) || "tables" in source) return raw;
  const { types, ...rest } = source;
  return { ...rest, tables: types };
}

/**
 * Rewrite the pre-rename `typeName` / `previousTypeName` keys to their current
 * names across every persisted position that carries a table name.
 * @param {unknown} raw - Parsed diff.json contents
 * @returns {unknown} Diff contents with legacy field names rewritten
 */
function normalizeLegacyFieldNames(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const source = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...source };
  for (const key of LEGACY_FIELD_CARRIERS) {
    const entries = source[key];
    if (!Array.isArray(entries)) continue;
    normalized[key] = entries.map(renameLegacyEntryFields);
  }
  return normalized;
}

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
 * Normalize a snapshot table into the canonical comparison shape, returning a
 * new object rather than mutating the input. Currently fills:
 *   - `pluralForm` via inflection when missing (legacy snapshots written
 *     before `pluralForm` became required may omit it)
 *   - per-field `scale` defaults via {@link normalizeSnapshotField}
 *
 * Idempotent — safe to call multiple times on the same input.
 * @param {TailorDBSnapshotType} type - Snapshot table to normalize
 * @returns {TailorDBSnapshotType} A new, normalized snapshot table object
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
  const tables = createSnapshotRecord<TailorDBSnapshotType>();
  for (const [tableName, type] of Object.entries(snapshot.tables)) {
    tables[tableName] = normalizeSnapshotType(type);
  }
  return { ...snapshot, tables } as NormalizedSchemaSnapshot;
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
  SnapshotEnumValue,
  SnapshotFieldConfig,
  SnapshotIndexConfig,
  SnapshotRelationship,
  SnapshotPermissionOperand,
  SnapshotPermissionCondition,
  SnapshotActionPermission,
  SnapshotRecordPermission,
  SnapshotGqlPermissionPolicy,
  SnapshotGqlPermission,
  SnapshotGqlOperations,
  SnapshotSettings,
  TailorDBSnapshotType,
  SchemaSnapshot,
  NormalizedSchemaSnapshot,
  RebaselineMarker,
} from "./snapshot-types";

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
// Snapshot Creation
// ============================================================================

/**
 * Create a snapshot field config from an OperatorFieldConfig.
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
  if (fieldConfig.default !== undefined) config.default = fieldConfig.default;

  // Recursive for nested fields
  if (fieldConfig.fields && Object.keys(fieldConfig.fields).length > 0) {
    const fields = createSnapshotRecord<SnapshotFieldConfig>();
    for (const [nestedName, nestedConfig] of Object.entries(fieldConfig.fields)) {
      fields[nestedName] = createSnapshotFieldConfigFromOperatorConfig(nestedConfig);
    }
    config.fields = fields;
  }

  return normalizeSnapshotField(config);
}

/**
 * Create a snapshot table from a parsed table
 * @param {TailorDBType} type - Parsed TailorDB table definition
 * @returns {TailorDBSnapshotType} Snapshot table configuration
 */
export function createSnapshotType(type: TailorDBType): TailorDBSnapshotType {
  const fields = createSnapshotRecord<SnapshotFieldConfig>();

  for (const [fieldName, field] of Object.entries(type.fields)) {
    fields[fieldName] = createSnapshotFieldConfigFromOperatorConfig(field.config);
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
    const indexes = createSnapshotRecord<SnapshotIndexConfig>();
    for (const [indexName, indexConfig] of Object.entries(type.indexes)) {
      indexes[indexName] = {
        fields: indexConfig.fields,
        unique: indexConfig.unique,
      };
    }
    snapshotType.indexes = indexes;
  }

  if (type.files && Object.keys(type.files).length > 0) {
    snapshotType.files = { ...type.files };
  }

  if (type.typeHookExpr) {
    snapshotType.typeHookExpr = type.typeHookExpr;
  }

  if (type.typeValidateExpr) {
    snapshotType.typeValidateExpr = type.typeValidateExpr;
  }

  if (Object.keys(type.forwardRelationships).length > 0) {
    const forwardRelationships = createSnapshotRecord<SnapshotRelationship>();
    for (const [relName, rel] of Object.entries(type.forwardRelationships)) {
      forwardRelationships[relName] = {
        targetType: rel.targetType,
        targetField: rel.targetField,
        sourceField: rel.sourceField,
        isArray: rel.isArray,
        description: rel.description,
      };
    }
    snapshotType.forwardRelationships = forwardRelationships;
  }

  if (Object.keys(type.backwardRelationships).length > 0) {
    const backwardRelationships = createSnapshotRecord<SnapshotRelationship>();
    for (const [relName, rel] of Object.entries(type.backwardRelationships)) {
      backwardRelationships[relName] = {
        targetType: rel.targetType,
        targetField: rel.targetField,
        sourceField: rel.sourceField,
        isArray: rel.isArray,
        description: rel.description,
      };
    }
    snapshotType.backwardRelationships = backwardRelationships;
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
 * Create a schema snapshot from local table definitions
 * @param {Record<string, TailorDBType>} types - Local table definitions
 * @param {string} namespace - Namespace for the snapshot
 * @returns {NormalizedSchemaSnapshot} Normalized schema snapshot
 */
export function createSnapshotFromLocalTypes(
  types: Record<string, TailorDBType>,
  namespace: string,
): NormalizedSchemaSnapshot {
  const snapshotTypes = createSnapshotRecord<TailorDBSnapshotType>();

  for (const [tableName, type] of Object.entries(types)) {
    snapshotTypes[tableName] = createSnapshotType(type);
  }

  return normalizeSchemaSnapshot({
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace,
    createdAt: new Date().toISOString(),
    tables: snapshotTypes,
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

const FIELD_REMOVED_WARNING_REASON =
  "Field removed (existing data will no longer be accessible through the schema)";
const TABLE_REMOVED_WARNING_REASON =
  "Table removed (all records in this table will be deleted during post-migration cleanup)";

/**
 * Reconstruct data-loss warnings from removal changes for diff.json files
 * written before the warning tier existed
 * @param {MigrationDiff} diff - Parsed legacy migration diff
 * @returns {WarningChangeInfo[]} Warnings equivalent to what diff generation would have recorded
 */
function deriveWarningsFromChanges(diff: MigrationDiff): WarningChangeInfo[] {
  const warnings: WarningChangeInfo[] = [];
  for (const change of diff.changes) {
    if (change.kind === "field_removed") {
      warnings.push({
        tableName: change.tableName,
        fieldName: change.fieldName,
        reason: FIELD_REMOVED_WARNING_REASON,
      });
    } else if (change.kind === "table_removed") {
      warnings.push({ tableName: change.tableName, reason: TABLE_REMOVED_WARNING_REASON });
    }
  }
  return warnings;
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
  for (const prop of SNAPSHOT_FIELD_BOOLEAN_PROPS) {
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

  if (oldField.default !== newField.default) {
    if (typeof oldField.default !== typeof newField.default) return true;
    if (JSON.stringify(oldField.default) !== JSON.stringify(newField.default)) return true;
  }

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
 * Collect breaking changes for a field change
 * @param {string} tableName - Name of the table containing the field
 * @param {string} fieldName - Name of the field being changed
 * @param {SnapshotFieldConfig | undefined} oldField - Old field configuration
 * @param {SnapshotFieldConfig | undefined} newField - New field configuration
 * @param {ReadonlyMap<string, string>} [typeRenameTargets] - Confirmed table renames (old name → new name)
 * @returns {BreakingChangeInfo[]} Breaking change information
 */
function getBreakingFieldChanges(
  tableName: string,
  fieldName: string,
  oldField: SnapshotFieldConfig | undefined,
  newField: SnapshotFieldConfig | undefined,
  typeRenameTargets?: ReadonlyMap<string, string>,
): BreakingChangeInfo[] {
  const breakingChanges: BreakingChangeInfo[] = [];

  // Field added as required - breaking (existing records don't have this value)
  if (!oldField && newField && newField.required) {
    breakingChanges.push({
      tableName,
      fieldName,
      reason: "Required field added",
    });
  }

  // Compatible scalar type changes use a phased in-place migration. Other
  // pairs still require expand-contract migration support.
  if (oldField && newField && oldField.type !== newField.type) {
    const supported = supportsInPlaceFieldTypeChange(oldField, newField);
    breakingChanges.push({
      tableName,
      fieldName,
      reason: `Field type changed from ${oldField.type} to ${newField.type}`,
      ...(!supported && { unsupported: true, showThreeStepHint: true }),
    });
  }

  // Optional to required - breaking
  if (oldField && newField && !oldField.required && newField.required) {
    breakingChanges.push({
      tableName,
      fieldName,
      reason: "Field changed from optional to required",
    });
  }

  // Array property changed - unsupported (requires 3-step migration)
  if (oldField && newField && (oldField.array ?? false) !== (newField.array ?? false)) {
    const [fromType, toType] = oldField.array
      ? ["array", "single value"]
      : ["single value", "array"];
    breakingChanges.push({
      tableName,
      fieldName,
      reason: `Field changed from ${fromType} to ${toType}`,
      unsupported: true,
      showThreeStepHint: true,
    });
  }

  // Foreign key relationship changed - breaking (existing references may become
  // invalid), unless it retargets a confirmed table rename: record ids are
  // preserved by the rename copy, so the stored references stay valid.
  if (oldField && newField && isBreakingForeignKeyRetarget(oldField, newField, typeRenameTargets)) {
    breakingChanges.push({
      tableName,
      fieldName,
      reason: `Foreign key target type changed from ${oldField.foreignKeyType} to ${newField.foreignKeyType}`,
    });
  }

  // Unique constraint added - breaking (existing duplicate values would violate constraint)
  if (oldField && newField && !(oldField.unique ?? false) && (newField.unique ?? false)) {
    breakingChanges.push({
      tableName,
      fieldName,
      reason: "Unique constraint added to field",
    });
  }

  // Decimal scale changed - breaking (rows stored under the old scale must be
  // re-saved so their stored precision matches the new schema)
  if (
    oldField?.type === "decimal" &&
    newField?.type === "decimal" &&
    oldField.scale !== newField.scale
  ) {
    breakingChanges.push({
      tableName,
      fieldName,
      reason: `Decimal scale changed from ${oldField.scale} to ${newField.scale}`,
    });
  }

  // Enum values removed - breaking (existing records may have removed values)
  if (oldField && newField && oldField.type === "enum" && newField.type === "enum") {
    const oldAllowed = oldField.allowedValues ?? [];
    const newAllowed = newField.allowedValues ?? [];
    const oldValues = oldAllowed.map((v) => v.value);
    const newValuesSet = new Set(newAllowed.map((v) => v.value));
    const removedValues = oldValues.filter((v) => !newValuesSet.has(v));
    if (removedValues.length > 0) {
      breakingChanges.push({
        tableName,
        fieldName,
        reason: `Enum values removed: ${removedValues.join(", ")}`,
      });
    }
  }

  return breakingChanges;
}

/**
 * Context for collecting diff changes, breaking changes, and warnings
 */
interface DiffContext {
  changes: DiffChange[];
  breakingChanges: BreakingChangeInfo[];
  warnings: WarningChangeInfo[];
  /** Confirmed table renames (old name → new name), for reference retargets. */
  typeRenameTargets?: ReadonlyMap<string, string>;
}

function addChange(
  ctx: DiffContext,
  change: FieldDiffChange,
  oldField: SnapshotFieldConfig | undefined,
  newField: SnapshotFieldConfig | undefined,
): void {
  ctx.changes.push(change);

  if (!change.fieldName) return;

  const breakingChanges = getBreakingFieldChanges(
    change.tableName,
    change.fieldName,
    oldField,
    newField,
    ctx.typeRenameTargets,
  );
  if (breakingChanges.length > 0) {
    ctx.breakingChanges.push(...breakingChanges);
    return;
  }

  // Non-breaking removal still risks losing schema access: surface a warning so users
  // can decide whether to add a migration script (e.g. JOIN through a
  // soon-to-be-dropped foreign key before it disappears).
  if (change.kind === "field_removed") {
    ctx.warnings.push({
      tableName: change.tableName,
      fieldName: change.fieldName,
      reason: FIELD_REMOVED_WARNING_REASON,
    });
  }
}

function compareTypeFields(
  ctx: DiffContext,
  tableName: string,
  prevType: TailorDBSnapshotType,
  currType: TailorDBSnapshotType,
  fieldRenames: readonly FieldRenameSpec[] = [],
): void {
  const prevFieldNames = new Set(Object.keys(prevType.fields));
  const currFieldNames = new Set(Object.keys(currType.fields));
  const renamedFromNames = new Set(fieldRenames.map((r) => r.previousFieldName));
  const renamedToNames = new Set(fieldRenames.map((r) => r.fieldName));

  for (const rename of fieldRenames) {
    const prevField = assertDefined(
      prevType.fields[rename.previousFieldName],
      `renamed field "${rename.previousFieldName}" missing from prevType`,
    );
    const currField = assertDefined(
      currType.fields[rename.fieldName],
      `renamed field "${rename.fieldName}" missing from currType`,
    );
    ctx.changes.push({
      kind: "field_renamed",
      tableName,
      fieldName: rename.fieldName,
      previousFieldName: rename.previousFieldName,
      before: prevField,
      after: currField,
    });
    ctx.breakingChanges.push({
      tableName,
      fieldName: rename.fieldName,
      reason: `Field renamed from ${rename.previousFieldName} to ${rename.fieldName} (existing values must be copied by the migration script)`,
    });
  }

  // Check for added fields
  for (const fieldName of currFieldNames) {
    if (renamedToNames.has(fieldName)) continue;
    if (!prevFieldNames.has(fieldName)) {
      const currField = assertDefined(
        currType.fields[fieldName],
        `field "${fieldName}" missing from currType`,
      );
      addChange(
        ctx,
        {
          kind: "field_added",
          tableName,
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
    if (renamedFromNames.has(fieldName)) continue;
    if (!currFieldNames.has(fieldName)) {
      const prevField = assertDefined(
        prevType.fields[fieldName],
        `field "${fieldName}" missing from prevType`,
      );
      addChange(
        ctx,
        {
          kind: "field_removed",
          tableName,
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
          kind: prevField.type === currField.type ? "field_modified" : "field_type_modified",
          tableName,
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
 * Determine if a table-level index change is breaking. Mirrors the field-level
 * unique reasoning: enforcing a unique constraint over existing rows can fail
 * on duplicates, so both adding a unique index and re-pointing an existing
 * unique index at a different field set require a data migration.
 * @param {string} tableName - Name of the table containing the index
 * @param {string} indexName - Name of the index being changed
 * @param {SnapshotIndexConfig | undefined} oldIndex - Old index configuration
 * @param {SnapshotIndexConfig | undefined} newIndex - New index configuration
 * @returns {BreakingChangeInfo | null} Breaking change info or null if not breaking
 */
export function isBreakingIndexChange(
  tableName: string,
  indexName: string,
  oldIndex: SnapshotIndexConfig | undefined,
  newIndex: SnapshotIndexConfig | undefined,
): BreakingChangeInfo | null {
  if (!newIndex || !(newIndex.unique ?? false)) return null;

  // Unique index added, or unique constraint added to an existing index
  if (!oldIndex || !(oldIndex.unique ?? false)) {
    return {
      tableName,
      reason: `Unique constraint added to index "${indexName}"`,
    };
  }

  // Unique index re-pointed at a different field set: the old constraint is
  // dropped and a new one enforced, so duplicates are just as possible.
  if (JSON.stringify(oldIndex.fields.toSorted()) !== JSON.stringify(newIndex.fields.toSorted())) {
    return {
      tableName,
      reason: `Unique index fields changed on index "${indexName}"`,
    };
  }

  return null;
}

/**
 * Compare table-level indexes
 * @param {DiffContext} ctx - Diff context
 * @param {string} tableName - Table name
 * @param {Record<string, SnapshotIndexConfig> | undefined} oldIndexes - Previous indexes
 * @param {Record<string, SnapshotIndexConfig> | undefined} newIndexes - Current indexes
 * @returns {void}
 */
function compareIndexes(
  ctx: DiffContext,
  tableName: string,
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
        tableName,
        indexName,
        after: indexConfig,
      });
      const breaking = isBreakingIndexChange(tableName, indexName, undefined, indexConfig);
      if (breaking) {
        ctx.breakingChanges.push(breaking);
      }
    }
  }

  // Index removed
  for (const [indexName, indexConfig] of Object.entries(oldIndexes ?? {})) {
    if (!newKeys.has(indexName)) {
      ctx.changes.push({
        kind: "index_removed",
        tableName,
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
          tableName,
          indexName,
          reason: reasons.join(", "),
          before: oldIndex,
          after: newIndex,
        });
        const breaking = isBreakingIndexChange(tableName, indexName, oldIndex, newIndex);
        if (breaking) {
          ctx.breakingChanges.push(breaking);
        }
      }
    }
  }
}

/**
 * Compare table-level file fields
 * @param {DiffContext} ctx - Diff context
 * @param {string} tableName - Table name
 * @param {Record<string, string> | undefined} oldFiles - Previous file fields
 * @param {Record<string, string> | undefined} newFiles - Current file fields
 * @returns {void}
 */
function compareFiles(
  ctx: DiffContext,
  tableName: string,
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
        tableName,
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
        tableName,
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
          tableName,
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
 * Compare table-level relationships
 * @param {DiffContext} ctx - Diff context
 * @param {string} tableName - Table name
 * @param {"forward" | "backward"} relationshipType - Relationship direction to compare
 * @param {Record<string, SnapshotRelationship> | undefined} oldRelationships - Previous relationships
 * @param {Record<string, SnapshotRelationship> | undefined} newRelationships - Current relationships
 * @returns {void}
 */
function compareRelationships(
  ctx: DiffContext,
  tableName: string,
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
        tableName,
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
        tableName,
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
          tableName,
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
 * Compare table-level permissions
 * @param {DiffContext} ctx - Diff context
 * @param {string} tableName - Table name
 * @param {SnapshotRecordPermission | undefined} oldRecordPerm - Previous record permission
 * @param {SnapshotRecordPermission | undefined} newRecordPerm - Current record permission
 * @param {SnapshotGqlPermission | undefined} oldGqlPerm - Previous GQL permission
 * @param {SnapshotGqlPermission | undefined} newGqlPerm - Current GQL permission
 * @returns {void}
 */
function comparePermissions(
  ctx: DiffContext,
  tableName: string,
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
      tableName,
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
  tableName: string,
  previous: TailorDBSnapshotType,
  current: TailorDBSnapshotType,
): void {
  const previousComparable = comparableTypeSettings(previous);
  const currentComparable = comparableTypeSettings(current);

  if (JSON.stringify(previousComparable) === JSON.stringify(currentComparable)) return;

  ctx.changes.push({
    kind: "table_settings_modified",
    tableName,
    reason: "settings changed",
    before: snapshotTypeSettingsState(previous),
    after: snapshotTypeSettingsState(current),
  });
}

function typeScriptsState(type: TailorDBSnapshotType): TypeScriptsState {
  return {
    ...(type.typeHookExpr && { typeHookExpr: type.typeHookExpr }),
    ...(type.typeValidateExpr !== undefined && { typeValidateExpr: type.typeValidateExpr }),
  };
}

function compareTypeScripts(
  ctx: DiffContext,
  tableName: string,
  previous: TailorDBSnapshotType,
  current: TailorDBSnapshotType,
): void {
  const prevState = typeScriptsState(previous);
  const currState = typeScriptsState(current);

  if (JSON.stringify(prevState) === JSON.stringify(currState)) return;

  ctx.changes.push({
    kind: "table_scripts_modified",
    tableName,
    reason: "table-level scripts changed",
    before: prevState,
    after: currState,
  });
}

/**
 * Restate the schema an expand migration starts from, with each converted field
 * relaxed to optional.
 *
 * The expand script clears the original field once it has carried the value
 * across. That write reaches the field under the contract recorded on the
 * removal, which the deploy restores for the duration of the migration, so a
 * field left required would reject it.
 * @param previous - Snapshot the expand migration starts from
 * @param plans - Field changes carried through temporary fields
 * @returns Snapshot to compare the expand migration against
 */
function buildExpandBaseSnapshot(
  previous: NormalizedSchemaSnapshot,
  plans: readonly ExpandContractPlan[],
): NormalizedSchemaSnapshot {
  const tables = copySnapshotRecord(previous.tables);
  for (const plan of plans) {
    const type = tables[plan.tableName];
    const original = type?.fields[plan.fieldName];
    if (!type || !original) continue;
    const fields = copySnapshotRecord(type.fields);
    fields[plan.fieldName] = { ...original, required: false };
    tables[plan.tableName] = { ...type, fields };
  }
  return normalizeSchemaSnapshot({ ...previous, tables });
}

/**
 * Build the diff for the migration that converts values into temporary fields.
 *
 * Adding an optional field and removing one are both non-breaking, so nothing
 * in the comparison marks the script as required — yet it is the only thing
 * carrying the values across before the original field is dropped.
 * @param previous - Snapshot the expand migration starts from
 * @param intermediate - Snapshot the expand migration produces
 * @param plans - Field changes carried through temporary fields
 * @returns Diff to write for the expand migration
 */
export function buildExpandDiff(
  previous: NormalizedSchemaSnapshot,
  intermediate: NormalizedSchemaSnapshot,
  plans: readonly ExpandContractPlan[],
): MigrationDiff {
  const diff = compareSnapshots(buildExpandBaseSnapshot(previous, plans), intermediate);
  return { ...diff, requiresMigrationScript: true };
}

/**
 * Build the schema state that sits between an expand and a contract migration:
 * each converted field is replaced by its temporary counterpart.
 *
 * The original field is dropped here rather than in the contract migration so
 * the contract can reuse its name. It stays readable while the expand script
 * runs, because a field removed by a migration is retained until that same
 * migration's post phase.
 *
 * The temporary field is optional and non-unique regardless of its final
 * contract, since the expand script fills it in batches.
 * @param previous - Snapshot the expand migration starts from
 * @param plans - Field changes carried through temporary fields
 * @returns Snapshot the contract migration compares against
 */
export function buildIntermediateSnapshot(
  previous: NormalizedSchemaSnapshot,
  plans: readonly ExpandContractPlan[],
): NormalizedSchemaSnapshot {
  const tables = copySnapshotRecord(previous.tables);
  for (const plan of plans) {
    const type = tables[plan.tableName];
    if (!type) continue;
    const fields = copySnapshotRecord(type.fields);
    // Hooks and validation stay off the temporary field: the rename re-applies
    // the real contract, and a non-idempotent update hook would otherwise run
    // once on the conversion and again on the copy.
    const { hooks: _hooks, validate: _validate, ...carried } = plan.after;
    fields[plan.tempFieldName] = { ...carried, required: false, unique: false };
    delete fields[plan.fieldName];
    tables[plan.tableName] = { ...type, fields };
  }
  return normalizeSchemaSnapshot({ ...previous, tables });
}

/**
 * Options for {@link compareSnapshots}.
 */
export interface CompareSnapshotsOptions {
  /**
   * Confirmed field renames. Each spec replaces the corresponding
   * `field_removed` + `field_added` pair with a single breaking
   * `field_renamed` change. Specs are validated against both snapshots.
   */
  fieldRenames?: readonly FieldRenameSpec[];
  /**
   * Confirmed table renames. Each spec replaces the corresponding
   * `table_removed` + `table_added` pair with a single breaking
   * `table_renamed` change. Specs are validated against both snapshots.
   */
  typeRenames?: readonly TypeRenameSpec[];
}

/**
 * Compare two normalized snapshots and generate a diff
 * @param {NormalizedSchemaSnapshot} previous - Previous normalized snapshot
 * @param {NormalizedSchemaSnapshot} current - Current normalized snapshot
 * @param {CompareSnapshotsOptions} [options] - Comparison options
 * @returns {MigrationDiff} Migration diff between snapshots
 */
export function compareSnapshots(
  previous: NormalizedSchemaSnapshot,
  current: NormalizedSchemaSnapshot,
  options?: CompareSnapshotsOptions,
): MigrationDiff {
  const fieldRenames = options?.fieldRenames ?? [];
  assertValidFieldRenames(previous, current, fieldRenames);
  const renamesByType = new Map<string, FieldRenameSpec[]>();
  for (const rename of fieldRenames) {
    const list = renamesByType.get(rename.tableName) ?? [];
    list.push(rename);
    renamesByType.set(rename.tableName, list);
  }
  const typeRenames = options?.typeRenames ?? [];
  assertValidTypeRenames(previous, current, typeRenames);
  const typeRenameTargets = new Map(typeRenames.map((r) => [r.previousTableName, r.tableName]));
  const renamedToTypeNames = new Set(typeRenames.map((r) => r.tableName));

  const ctx: DiffContext = {
    changes: [],
    breakingChanges: [],
    warnings: [],
    typeRenameTargets,
  };

  const previousTypeNames = new Set(Object.keys(previous.tables));
  const currentTypeNames = new Set(Object.keys(current.tables));

  // Record confirmed table renames
  for (const rename of typeRenames) {
    const prevType = assertDefined(
      previous.tables[rename.previousTableName],
      `renamed table "${rename.previousTableName}" missing from previous snapshot`,
    );
    const currType = assertDefined(
      current.tables[rename.tableName],
      `renamed table "${rename.tableName}" missing from current snapshot`,
    );
    ctx.changes.push({
      kind: "table_renamed",
      tableName: rename.tableName,
      previousTableName: rename.previousTableName,
      before: prevType,
      after: currType,
    });
    ctx.breakingChanges.push({
      tableName: rename.tableName,
      reason: `Table renamed from ${rename.previousTableName} to ${rename.tableName} (existing records must be copied by the migration script)`,
    });
    ctx.breakingChanges.push({
      tableName: rename.tableName,
      reason:
        `GraphQL API names derived from ${rename.previousTableName}/${prevType.pluralForm} change to ` +
        `${rename.tableName}/${currType.pluralForm} — breaking for API clients`,
    });
  }

  // Check for added tables
  for (const [tableName, type] of Object.entries(current.tables)) {
    if (renamedToTypeNames.has(tableName)) continue;
    if (!previousTypeNames.has(tableName)) {
      ctx.changes.push({
        kind: "table_added",
        tableName,
        after: type,
      });
    }
  }

  // Check for removed tables
  for (const [tableName, type] of Object.entries(previous.tables)) {
    if (typeRenameTargets.has(tableName)) continue;
    if (!currentTypeNames.has(tableName)) {
      ctx.changes.push({
        kind: "table_removed",
        tableName,
        before: type,
      });
      ctx.warnings.push({
        tableName,
        reason: TABLE_REMOVED_WARNING_REASON,
      });
    }
  }

  // Check for modified tables
  for (const tableName of currentTypeNames) {
    if (!previousTypeNames.has(tableName)) continue;

    const prevType = assertDefined(
      previous.tables[tableName],
      `table "${tableName}" missing from previous snapshot`,
    );
    const currType = assertDefined(
      current.tables[tableName],
      `table "${tableName}" missing from current snapshot`,
    );

    // Compare table-level settings and metadata
    compareTypeSettings(ctx, tableName, prevType, currType);

    // Compare table-level hook/validate scripts
    compareTypeScripts(ctx, tableName, prevType, currType);

    // Compare fields
    compareTypeFields(ctx, tableName, prevType, currType, renamesByType.get(tableName));

    // Compare indexes
    compareIndexes(ctx, tableName, prevType.indexes, currType.indexes);

    // Compare file fields
    compareFiles(ctx, tableName, prevType.files, currType.files);

    // Compare relationships
    compareRelationships(
      ctx,
      tableName,
      "forward",
      prevType.forwardRelationships,
      currType.forwardRelationships,
    );
    compareRelationships(
      ctx,
      tableName,
      "backward",
      prevType.backwardRelationships,
      currType.backwardRelationships,
    );

    // Compare permissions
    comparePermissions(
      ctx,
      tableName,
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
 * Compare a snapshot against canonical TailorDBSnapshotType-shaped local tables.
 * Callers are expected to pre-convert TailorDBService.types to TailorDBSnapshotType via
 * `createSnapshotType`. As a safety net, both sides are re-run through idempotent
 * normalization here, so a caller that forgets will still get correct
 * comparisons (no silent false drift).
 * @param {SchemaSnapshot} snapshot - Schema snapshot to compare against
 * @param {Record<string, TailorDBSnapshotType>} localTypes - Local snapshot-shaped tables
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
    tables: localTypes,
  };
  return compareSnapshots(
    normalizeSchemaSnapshot(snapshot),
    normalizeSchemaSnapshot(currentSnapshot),
  );
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
 * @param {ProtoTailorDBType} remoteType - Remote TailorDB table from API
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
 * Convert remote TailorDB tables into the normalized snapshot shape used by drift checks.
 * @param {ProtoTailorDBType[]} remoteTypes - Remote TailorDB tables from the API
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
  const tables = createSnapshotRecord<TailorDBSnapshotType>();
  for (const remoteType of remoteTypes) {
    tables[remoteType.name] = convertRemoteTypeToSnapshot(
      remoteType,
      expectedSnapshot?.tables[remoteType.name],
    );
  }

  for (const permission of remoteGqlPermissions) {
    const { typeName: tableName } = permission;
    const snapshotType = tables[tableName];
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
    tables,
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

  for (const key of SNAPSHOT_FIELD_BOOLEAN_PROPS) {
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
 * @param {string} tableName - Name of the table
 * @param {string} fieldName - Name of the field
 * @param {SnapshotFieldConfig} remoteField - Remote field config
 * @param {SnapshotFieldConfig} snapshotField - Snapshot field config
 * @returns {SchemaDrift | null} Drift info or null if fields match
 */
function compareFields(
  tableName: string,
  fieldName: string,
  remoteField: SnapshotFieldConfig,
  snapshotField: SnapshotFieldConfig,
): SchemaDrift | null {
  const differences: string[] = [];
  addFieldDifferences(differences, "", remoteField, snapshotField);

  if (differences.length > 0) {
    return {
      tableName,
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
 * Compare remote TailorDB tables with a local snapshot
 * @param {ProtoTailorDBType[]} remoteTypes - Remote tables from listParsedTailorDBTypes API
 * @param {SchemaSnapshot} snapshot - Local schema snapshot
 * @param {readonly RemoteGqlPermission[]} remoteGqlPermissions - Remote GQL permissions for the namespace
 * @returns {SchemaDrift[]} List of drifts detected
 */
export function compareRemoteWithSnapshot(
  remoteTypes: ProtoTailorDBType[],
  snapshot: SchemaSnapshot,
  remoteGqlPermissions: readonly RemoteGqlPermission[] = [],
): SchemaDrift[] {
  const structuralDrifts = compareNormalizedRemoteWithSnapshot(
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

  const scriptDrifts = compareScriptHashes(remoteTypes, snapshot);

  return [...structuralDrifts, ...scriptDrifts];
}

function extractRemoteScriptHash(remoteType: ProtoTailorDBType): string | undefined {
  const exprs = [
    remoteType.schema?.typeHook?.create?.expr,
    remoteType.schema?.typeHook?.update?.expr,
    remoteType.schema?.typeValidate?.create?.expr,
    remoteType.schema?.typeValidate?.update?.expr,
  ];
  let found: string | undefined;
  for (const expr of exprs) {
    if (expr) {
      const hash = extractSourceScriptHash(expr);
      if (hash) {
        if (found && found !== hash) return undefined;
        found = hash;
      }
    }
  }
  return found;
}

function remoteHasScripts(remoteType: ProtoTailorDBType): boolean {
  return !!(
    remoteType.schema?.typeHook?.create?.expr ||
    remoteType.schema?.typeHook?.update?.expr ||
    remoteType.schema?.typeValidate?.create?.expr ||
    remoteType.schema?.typeValidate?.update?.expr
  );
}

function compareScriptHashes(
  remoteTypes: ProtoTailorDBType[],
  snapshot: SchemaSnapshot,
): SchemaDrift[] {
  const drifts: SchemaDrift[] = [];
  const remoteByName = new Map(remoteTypes.map((t) => [t.name, t]));

  for (const [tableName, snapshotType] of Object.entries(snapshot.tables)) {
    const localHash = computeSourceScriptHash(snapshotType.fields, {
      typeHookExpr: snapshotType.typeHookExpr,
      typeValidateExpr: snapshotType.typeValidateExpr,
    });

    const remoteType = remoteByName.get(tableName);
    if (!remoteType) continue;

    if (localHash) {
      const remoteHash = extractRemoteScriptHash(remoteType);
      if (localHash !== remoteHash) {
        drifts.push({
          tableName,
          kind: "script_mismatch",
          details: remoteHash
            ? `Table '${tableName}' scripts differ between remote and snapshot`
            : `Table '${tableName}' has no script hash on remote`,
        });
      }
    } else if (remoteHasScripts(remoteType)) {
      drifts.push({
        tableName,
        kind: "script_mismatch",
        details: `Table '${tableName}' has scripts on remote but not in snapshot`,
      });
    }
  }

  return drifts;
}

function stripFieldScriptProps(field: SnapshotFieldConfig): SnapshotFieldConfig {
  const { hooks: _hooks, validate: _validate, default: _default, ...rest } = field;
  if (rest.fields) {
    const nested = createSnapshotRecord<SnapshotFieldConfig>();
    for (const [name, f] of Object.entries(rest.fields)) {
      nested[name] = stripFieldScriptProps(f);
    }
    return { ...rest, fields: nested };
  }
  return rest;
}

function createRemoteComparableSnapshot(snapshot: SchemaSnapshot): NormalizedSchemaSnapshot {
  const tables = createSnapshotRecord<TailorDBSnapshotType>();

  for (const [tableName, type] of Object.entries(snapshot.tables)) {
    const fields = createSnapshotRecord<SnapshotFieldConfig>();
    for (const [fieldName, field] of Object.entries(type.fields)) {
      if (SYSTEM_FIELDS.has(fieldName)) continue;
      fields[fieldName] = stripFieldScriptProps(field);
    }
    const { typeHookExpr: _, typeValidateExpr: __, ...typeRest } = type;
    tables[tableName] = { ...typeRest, fields };
  }

  return normalizeSchemaSnapshot({
    ...snapshot,
    tables,
  });
}

function fieldDriftFromChange(
  change: Extract<DiffChange, { kind: "field_modified" | "field_type_modified" }>,
): SchemaDrift {
  return (
    compareFields(change.tableName, change.fieldName, change.before, change.after) ?? {
      tableName: change.tableName,
      kind: "field_mismatch",
      fieldName: change.fieldName,
      details: `Field '${change.fieldName}' differs between remote and snapshot`,
    }
  );
}

function schemaDriftFromDiffChange(change: DiffChange): SchemaDrift {
  switch (change.kind) {
    case "table_added":
      return {
        tableName: change.tableName,
        kind: "type_missing_remote",
        details: `Table '${change.tableName}' exists in snapshot but not in remote`,
      };
    case "table_removed":
      return {
        tableName: change.tableName,
        kind: "type_missing_local",
        details: `Table '${change.tableName}' exists in remote but not in snapshot`,
      };
    // Drift comparison never confirms renames, so this kind cannot occur here;
    // report it as a plain type mismatch if it ever does.
    case "table_renamed":
      return {
        tableName: change.tableName,
        kind: "type_settings_mismatch",
        details: `Table '${change.previousTableName}' was renamed to '${change.tableName}'`,
      };
    case "table_settings_modified":
    case "table_modified":
      return {
        tableName: change.tableName,
        kind: "type_settings_mismatch",
        details: change.reason ?? "Table settings differ between remote and snapshot",
      };
    case "field_added":
      return {
        tableName: change.tableName,
        kind: "field_missing_remote",
        fieldName: change.fieldName,
        details: `Field '${change.fieldName}' exists in snapshot but not in remote`,
      };
    case "field_removed":
      return {
        tableName: change.tableName,
        kind: "field_missing_local",
        fieldName: change.fieldName,
        details: `Field '${change.fieldName}' exists in remote but not in snapshot`,
      };
    case "field_modified":
    case "field_type_modified":
      return fieldDriftFromChange(change);
    // Drift comparison never confirms renames, so this kind cannot occur here;
    // report it as a plain field mismatch if it ever does.
    case "field_renamed":
      return {
        tableName: change.tableName,
        kind: "field_mismatch",
        fieldName: change.fieldName,
        details: `Field '${change.previousFieldName}' was renamed to '${change.fieldName}'`,
      };
    case "index_added":
      return {
        tableName: change.tableName,
        kind: "index_missing_remote",
        indexName: change.indexName,
        details: `Index '${change.indexName}' exists in snapshot but not in remote`,
      };
    case "index_removed":
      return {
        tableName: change.tableName,
        kind: "index_missing_local",
        indexName: change.indexName,
        details: `Index '${change.indexName}' exists in remote but not in snapshot`,
      };
    case "index_modified":
      return {
        tableName: change.tableName,
        kind: "index_mismatch",
        indexName: change.indexName,
        details: change.reason ?? `Index '${change.indexName}' differs between remote and snapshot`,
      };
    case "file_added":
      return {
        tableName: change.tableName,
        kind: "file_missing_remote",
        fileName: change.fieldName,
        details: `File '${change.fieldName}' exists in snapshot but not in remote`,
      };
    case "file_removed":
      return {
        tableName: change.tableName,
        kind: "file_missing_local",
        fileName: change.fieldName,
        details: `File '${change.fieldName}' exists in remote but not in snapshot`,
      };
    case "file_modified":
      return {
        tableName: change.tableName,
        kind: "file_mismatch",
        fileName: change.fieldName,
        details: change.reason ?? `File '${change.fieldName}' differs between remote and snapshot`,
      };
    case "relationship_added":
      return {
        tableName: change.tableName,
        kind: "relationship_missing_remote",
        relationshipName: change.relationshipName,
        relationshipType: change.relationshipType,
        details: `Relationship '${change.relationshipName}' exists in snapshot but not in remote`,
      };
    case "relationship_removed":
      return {
        tableName: change.tableName,
        kind: "relationship_missing_local",
        relationshipName: change.relationshipName,
        relationshipType: change.relationshipType,
        details: `Relationship '${change.relationshipName}' exists in remote but not in snapshot`,
      };
    case "relationship_modified":
      return {
        tableName: change.tableName,
        kind: "relationship_mismatch",
        relationshipName: change.relationshipName,
        relationshipType: change.relationshipType,
        details:
          change.reason ??
          `Relationship '${change.relationshipName}' differs between remote and snapshot`,
      };
    case "permission_modified":
      return {
        tableName: change.tableName,
        kind: "permission_mismatch",
        details: change.reason ?? "Permissions differ between remote and snapshot",
      };
    case "table_scripts_modified":
      return {
        tableName: change.tableName,
        kind: "script_mismatch",
        details: change.reason ?? "Table-level scripts differ between remote and snapshot",
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
  return compareSnapshots(remoteSnapshot, snapshot).changes.map(schemaDriftFromDiffChange);
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

  // Group drifts by table
  const driftsByType = new Map<string, SchemaDrift[]>();
  for (const drift of drifts) {
    const existing = driftsByType.get(drift.tableName) ?? [];
    existing.push(drift);
    driftsByType.set(drift.tableName, existing);
  }

  for (const [tableName, typeDrifts] of driftsByType) {
    lines.push(`  Table '${tableName}':`);
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
