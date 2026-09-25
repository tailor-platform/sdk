import * as inflection from "inflection";
import { SCHEMA_SNAPSHOT_VERSION } from "./diff-calculator";
import {
  createSnapshotRecord,
  normalizeSchemaSnapshot,
  normalizeSnapshotField,
  normalizeSnapshotType,
} from "./snapshot-normalization";
import {
  type NormalizedSchemaSnapshot,
  type SnapshotActionPermission,
  type SnapshotFieldConfig,
  type SnapshotGqlAction,
  type SnapshotIndexConfig,
  type SnapshotPermissionCondition,
  type SnapshotRelationship,
  type TailorDBSnapshotType,
} from "./snapshot-types";
import type {
  TailorDBType,
  OperatorFieldConfig,
  StandardActionPermission,
} from "#/parser/service/tailordb/types";

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
    conditions: permission.conditions,
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
