/**
 * Snapshot-based Proto manifest generation for TailorDB migrations
 *
 * This module provides utilities for generating TailorDB proto manifests
 * directly from schema snapshots, enabling migration-based deployments
 * without relying on local TypeScript definitions.
 */

import { fromJson, type MessageInitShape } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  TailorDBGQLPermission_Action,
  TailorDBGQLPermission_Operator,
  TailorDBGQLPermission_Permit,
  type TailorDBGQLPermission_ConditionSchema,
  type TailorDBGQLPermission_OperandSchema,
  type TailorDBGQLPermission_PolicySchema,
  type TailorDBGQLPermissionSchema,
  TailorDBType_Permission_Operator,
  TailorDBType_Permission_Permit,
  type TailorDBType_FieldConfigSchema,
  type TailorDBType_FileConfigSchema,
  type TailorDBType_IndexSchema,
  type TailorDBType_Permission_ConditionSchema,
  type TailorDBType_Permission_OperandSchema,
  type TailorDBType_Permission_PolicySchema,
  type TailorDBType_PermissionSchema,
  type TailorDBType_RelationshipConfigSchema,
  type TailorDBTypeSchema,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import * as inflection from "inflection";
import { publishEventsConflict, resolvePublishEvents } from "#/cli/shared/publish-events";
import { buildTypeScripts } from "#/parser/service/tailordb/type-script";
import { isSnapshotFieldRefOperand } from "./snapshot";
import type {
  SchemaSnapshot,
  SnapshotEnumValue,
  SnapshotFieldConfig,
  TailorDBSnapshotType,
  SnapshotRelationship,
  SnapshotRecordPermission,
  SnapshotActionPermission,
  SnapshotGqlPermission,
  SnapshotGqlPermissionPolicy,
  SnapshotPermissionCondition,
  SnapshotPermissionOperand,
  SnapshotIndexConfig,
} from "./snapshot";

/**
 * Options for generating TailorDB table manifest from snapshot
 */
export interface GenerateManifestOptions {
  /** Whether an executor taking part in the same run subscribes to its record events */
  subscribed?: boolean;
  /**
   * Force record event publishing off, overriding a declared `publishEvents`.
   *
   * A table that declares `publishEvents: true` publishes no matter who
   * subscribes, so `subscribed` alone cannot silence it while migrations run.
   */
  suppressRecordEvents?: boolean;
  /** Force every GraphQL operation, including bulk upsert, off. */
  suppressGqlOperations?: boolean;
  /** Default gqlOperations for the namespace */
  namespaceGqlOperations?: {
    create?: boolean;
    update?: boolean;
    delete?: boolean;
    read?: boolean;
  };
}

/**
 * Whether a table's manifest enables record event publishing.
 *
 * The one place the rule lives: a declared `publishEvents` wins, and an unset
 * value follows whether an executor in the run subscribes.
 * @param snapshotType - Table to resolve the flag for
 * @param subscribed - Whether an executor taking part in the run subscribes
 * @returns Whether the table publishes record events
 */
function publishesRecordEvents(snapshotType: TailorDBSnapshotType, subscribed: boolean): boolean {
  return resolvePublishEvents({
    explicit: snapshotType.settings?.publishEvents,
    subscribed,
    conflict: publishEventsConflict.tailorDBType(snapshotType.name),
  });
}

/**
 * Generate a TailorDB table manifest from a snapshot table
 * @param {TailorDBSnapshotType} snapshotType - Snapshot table to generate manifest from
 * @param {GenerateManifestOptions} options - Generation options
 * @returns {MessageInitShape<typeof TailorDBTypeSchema>} Table manifest
 */
export function generateTailorDBTypeManifestFromSnapshot(
  snapshotType: TailorDBSnapshotType,
  options: GenerateManifestOptions = {},
): MessageInitShape<typeof TailorDBTypeSchema> {
  const pluralForm = inflection.camelize(snapshotType.pluralForm, true);

  // Build settings
  const defaultSettings: {
    aggregation: boolean;
    bulkUpsert: boolean;
    draft: boolean;
    defaultQueryLimitSize: bigint;
    maxBulkUpsertSize: bigint;
    pluralForm: string;
    publishRecordEvents: boolean;
    disableGqlOperations?: {
      create: boolean;
      update: boolean;
      delete: boolean;
      read: boolean;
    };
  } = {
    aggregation: snapshotType.settings?.aggregation ?? false,
    bulkUpsert:
      options.suppressGqlOperations === true ? false : (snapshotType.settings?.bulkUpsert ?? false),
    draft: false,
    defaultQueryLimitSize: 100n,
    maxBulkUpsertSize: 1000n,
    pluralForm,
    publishRecordEvents:
      options.suppressRecordEvents === true
        ? false
        : publishesRecordEvents(snapshotType, options.subscribed ?? false),
  };

  // Apply gqlOperations from snapshot settings or namespace default
  const ops = snapshotType.settings?.gqlOperations ?? options.namespaceGqlOperations;
  if (ops || options.suppressGqlOperations === true) {
    defaultSettings.disableGqlOperations = {
      create: options.suppressGqlOperations === true || ops?.create === false,
      update: options.suppressGqlOperations === true || ops?.update === false,
      delete: options.suppressGqlOperations === true || ops?.delete === false,
      read: options.suppressGqlOperations === true || ops?.read === false,
    };
  }

  // Build fields
  const fields: Record<
    string,
    MessageInitShape<typeof TailorDBType_FieldConfigSchema>
  > = Object.fromEntries(
    Object.entries(snapshotType.fields)
      .filter(([fieldName]) => fieldName !== "id")
      .map(([fieldName, fieldConfig]) => [fieldName, convertFieldConfigToProto(fieldConfig)]),
  );

  // Build relationships
  const relationships = new Map<
    string,
    MessageInitShape<typeof TailorDBType_RelationshipConfigSchema>
  >();

  if (snapshotType.forwardRelationships) {
    for (const [relationName, rel] of Object.entries(snapshotType.forwardRelationships)) {
      relationships.set(relationName, convertRelationshipToProto(rel, "forward"));
    }
  }

  if (snapshotType.backwardRelationships) {
    for (const [relationName, rel] of Object.entries(snapshotType.backwardRelationships)) {
      relationships.set(relationName, convertRelationshipToProto(rel, "backward"));
    }
  }

  // Build indexes
  const indexes = new Map<string, MessageInitShape<typeof TailorDBType_IndexSchema>>();
  if (snapshotType.indexes) {
    for (const [indexName, indexConfig] of Object.entries(snapshotType.indexes)) {
      indexes.set(indexName, convertIndexToProto(indexConfig));
    }
  }

  // Build files
  const files = new Map<string, MessageInitShape<typeof TailorDBType_FileConfigSchema>>();
  if (snapshotType.files) {
    for (const [fileName, description] of Object.entries(snapshotType.files)) {
      files.set(fileName, { description: description || "" });
    }
  }

  // Build permission
  const defaultPermission: MessageInitShape<typeof TailorDBType_PermissionSchema> = {
    create: [],
    read: [],
    update: [],
    delete: [],
  };
  const permission = snapshotType.permissions?.record
    ? convertRecordPermissionToProto(snapshotType.permissions.record)
    : defaultPermission;

  // Field hooks/validators are aggregated into table-level scripts so that a
  // single shared timestamp is observed across every field in one operation.
  const { typeHook, typeValidate } = buildTypeScripts(snapshotType.fields, {
    typeHookExpr: snapshotType.typeHookExpr,
    typeValidateExpr: snapshotType.typeValidateExpr,
  });

  return {
    name: snapshotType.name,
    schema: {
      description: snapshotType.description || "",
      fields,
      relationships: Object.fromEntries(relationships),
      settings: defaultSettings,
      extends: false,
      directives: [],
      indexes: Object.fromEntries(indexes),
      files: Object.fromEntries(files),
      permission,
      ...(typeHook && { typeHook }),
      ...(typeValidate && { typeValidate }),
    },
  };
}

function optionalOnCreate(
  config: Pick<SnapshotFieldConfig, "hooks" | "default">,
): Pick<MessageInitShape<typeof TailorDBType_FieldConfigSchema>, "optionalOnCreate"> {
  return config.hooks?.create || config.default !== undefined ? { optionalOnCreate: true } : {};
}

/**
 * Convert a snapshot field config to proto format
 * @param {SnapshotFieldConfig} config - Snapshot field config
 * @returns {MessageInitShape<typeof TailorDBType_FieldConfigSchema>} Proto field config
 */
export function convertFieldConfigToProto(
  config: SnapshotFieldConfig,
): MessageInitShape<typeof TailorDBType_FieldConfigSchema> {
  const fieldEntry: MessageInitShape<typeof TailorDBType_FieldConfigSchema> = {
    type: config.type,
    allowedValues:
      config.type === "enum"
        ? (config.allowedValues?.map((v: SnapshotEnumValue) => ({ ...v })) ?? [])
        : [],
    description: config.description || "",
    array: config.array ?? false,
    index: config.index ?? false,
    unique: config.unique ?? false,
    foreignKey: config.foreignKey ?? false,
    foreignKeyType: config.foreignKeyType,
    foreignKeyField: config.foreignKeyField,
    required: config.required,
    vector: config.vector ?? false,
    ...optionalOnCreate(config),
    ...(config.serial && {
      serial: {
        start: BigInt(config.serial.start),
        ...(config.serial.maxValue !== undefined && {
          maxValue: BigInt(config.serial.maxValue),
        }),
        ...(config.serial.format && {
          format: config.serial.format,
        }),
      },
    }),
    ...(config.scale !== undefined && { scale: config.scale }),
  };

  // Handle nested fields
  if (config.type === "nested" && config.fields) {
    fieldEntry.fields = processNestedFieldsFromSnapshot(config.fields);
  }

  return fieldEntry;
}

/**
 * Process nested fields from snapshot format to proto format
 * @param {Record<string, SnapshotFieldConfig>} fields - Nested fields
 * @returns {Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>>} Proto nested fields
 */
function processNestedFieldsFromSnapshot(
  fields: Record<string, SnapshotFieldConfig>,
): Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>> {
  const nestedFields = new Map<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>>();

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldConfig.type === "nested" && fieldConfig.fields) {
      const deepNestedFields = processNestedFieldsFromSnapshot(fieldConfig.fields);
      nestedFields.set(fieldName, {
        type: "nested",
        allowedValues: fieldConfig.allowedValues?.map((v: SnapshotEnumValue) => ({ ...v })) ?? [],
        description: fieldConfig.description || "",
        required: fieldConfig.required,
        array: fieldConfig.array ?? false,
        index: false,
        unique: false,
        foreignKey: false,
        vector: false,
        fields: deepNestedFields,
        ...(fieldConfig.scale !== undefined && { scale: fieldConfig.scale }),
      });
    } else {
      nestedFields.set(fieldName, {
        type: fieldConfig.type,
        allowedValues:
          fieldConfig.type === "enum"
            ? (fieldConfig.allowedValues?.map((v: SnapshotEnumValue) => ({ ...v })) ?? [])
            : [],
        description: fieldConfig.description || "",
        required: fieldConfig.required,
        array: fieldConfig.array ?? false,
        index: false,
        unique: false,
        foreignKey: false,
        vector: false,
        ...optionalOnCreate(fieldConfig),
        ...(fieldConfig.serial && {
          serial: {
            start: BigInt(fieldConfig.serial.start),
            ...(fieldConfig.serial.maxValue !== undefined && {
              maxValue: BigInt(fieldConfig.serial.maxValue),
            }),
            ...(fieldConfig.serial.format && {
              format: fieldConfig.serial.format,
            }),
          },
        }),
        ...(fieldConfig.scale !== undefined && { scale: fieldConfig.scale }),
      });
    }
  }

  return Object.fromEntries(nestedFields);
}

/**
 * Convert a snapshot relationship to proto format
 * @param {SnapshotRelationship} rel - Snapshot relationship
 * @param {"forward" | "backward"} direction - Relationship direction
 * @returns {MessageInitShape<typeof TailorDBType_RelationshipConfigSchema>} Proto relationship config
 */
function convertRelationshipToProto(
  rel: SnapshotRelationship,
  direction: "forward" | "backward",
): MessageInitShape<typeof TailorDBType_RelationshipConfigSchema> {
  if (direction === "forward") {
    return {
      refType: rel.targetType,
      refField: rel.sourceField,
      srcField: rel.targetField,
      array: rel.isArray,
      description: rel.description,
    };
  }
  // backward
  return {
    refType: rel.targetType,
    refField: rel.targetField,
    srcField: rel.sourceField,
    array: rel.isArray,
    description: rel.description,
  };
}

/**
 * Convert a snapshot index config to proto format
 * @param {SnapshotIndexConfig} indexConfig - Snapshot index config
 * @returns {MessageInitShape<typeof TailorDBType_IndexSchema>} Proto index config
 */
export function convertIndexToProto(
  indexConfig: SnapshotIndexConfig,
): MessageInitShape<typeof TailorDBType_IndexSchema> {
  return {
    fieldNames: indexConfig.fields,
    unique: indexConfig.unique ?? false,
  };
}

/**
 * Convert a snapshot record permission to proto format
 * @param {SnapshotRecordPermission} permission - Snapshot record permission
 * @returns {MessageInitShape<typeof TailorDBType_PermissionSchema>} Proto permission
 */
function convertRecordPermissionToProto(
  permission: SnapshotRecordPermission,
): MessageInitShape<typeof TailorDBType_PermissionSchema> {
  return {
    create: permission.create.map(convertActionPermissionToProto),
    read: permission.read.map(convertActionPermissionToProto),
    update: permission.update.map(convertActionPermissionToProto),
    delete: permission.delete.map(convertActionPermissionToProto),
  };
}

/**
 * Convert a snapshot action permission to proto format
 * @param {SnapshotActionPermission} policy - Snapshot action permission
 * @returns {MessageInitShape<typeof TailorDBType_Permission_PolicySchema>} Proto policy
 */
function convertActionPermissionToProto(
  policy: SnapshotActionPermission,
): MessageInitShape<typeof TailorDBType_Permission_PolicySchema> {
  let permit: TailorDBType_Permission_Permit;
  switch (policy.permit) {
    case "allow":
      permit = TailorDBType_Permission_Permit.ALLOW;
      break;
    case "deny":
      permit = TailorDBType_Permission_Permit.DENY;
      break;
    default:
      throw new Error(`Unknown permission: ${policy.permit satisfies never}`);
  }

  return {
    conditions: policy.conditions.map(convertConditionToProto),
    permit,
    description: policy.description,
  };
}

/**
 * Convert a snapshot permission condition to proto format
 * @param {SnapshotPermissionCondition} condition - Snapshot permission condition
 * @returns {MessageInitShape<typeof TailorDBType_Permission_ConditionSchema>} Proto condition
 */
function convertConditionToProto(
  condition: SnapshotPermissionCondition,
): MessageInitShape<typeof TailorDBType_Permission_ConditionSchema> {
  const [left, operator, right] = condition;

  const l = convertOperandToProto(left);
  const r = convertOperandToProto(right);

  let op: TailorDBType_Permission_Operator;
  switch (operator) {
    case "eq":
      op = TailorDBType_Permission_Operator.EQ;
      break;
    case "ne":
      op = TailorDBType_Permission_Operator.NE;
      break;
    case "in":
      op = TailorDBType_Permission_Operator.IN;
      break;
    case "nin":
      op = TailorDBType_Permission_Operator.NIN;
      break;
    case "hasAny":
      op = TailorDBType_Permission_Operator.HAS_ANY;
      break;
    case "nhasAny":
      op = TailorDBType_Permission_Operator.NHAS_ANY;
      break;
    default:
      throw new Error(`Unknown operator: ${operator satisfies never}`);
  }

  return {
    left: l,
    operator: op,
    right: r,
  };
}

/**
 * Convert a snapshot permission operand to proto format
 * @param {SnapshotPermissionOperand} operand - Snapshot permission operand
 * @returns {MessageInitShape<typeof TailorDBType_Permission_OperandSchema>} Proto operand
 */
function convertOperandToProto(
  operand: SnapshotPermissionOperand,
): MessageInitShape<typeof TailorDBType_Permission_OperandSchema> {
  if (isSnapshotFieldRefOperand(operand)) {
    if ("user" in operand) {
      return { kind: { case: "userField", value: operand.user } };
    }
    if ("record" in operand) {
      return { kind: { case: "recordField", value: operand.record } };
    }
    if ("newRecord" in operand) {
      return { kind: { case: "newRecordField", value: operand.newRecord } };
    }
    if ("oldRecord" in operand) {
      return { kind: { case: "oldRecordField", value: operand.oldRecord } };
    }
    operand satisfies never;
    throw new Error(`Unknown field-ref operand shape: ${JSON.stringify(operand)}`);
  }

  return {
    kind: { case: "value", value: fromJson(ValueSchema, operand) },
  };
}

/**
 * Options for generating all table manifests from a snapshot
 */
export interface GenerateAllManifestsOptions extends GenerateManifestOptions {
  /** Set of table names that should have publishRecordEvents enabled */
  executorUsedTables?: ReadonlySet<string>;
}

/**
 * Generate all TailorDB table manifests from a schema snapshot
 * @param {SchemaSnapshot} snapshot - Schema snapshot
 * @param {GenerateAllManifestsOptions} options - Generation options
 * @returns {Map<string, MessageInitShape<typeof TailorDBTypeSchema>>} Map of table name to manifest
 */
export function generateAllTypeManifestsFromSnapshot(
  snapshot: SchemaSnapshot,
  options: GenerateAllManifestsOptions = {},
): Map<string, MessageInitShape<typeof TailorDBTypeSchema>> {
  const manifests = new Map<string, MessageInitShape<typeof TailorDBTypeSchema>>();
  const { executorUsedTables, ...baseOptions } = options;

  for (const [tableName, snapshotType] of Object.entries(snapshot.tables)) {
    const typeOptions: GenerateManifestOptions = {
      ...baseOptions,
      subscribed: executorUsedTables?.has(tableName) ?? false,
    };
    manifests.set(tableName, generateTailorDBTypeManifestFromSnapshot(snapshotType, typeOptions));
  }

  return manifests;
}

/**
 * Result of comparing snapshot tables with existing remote tables
 */
export interface SnapshotTypeComparison {
  /** Tables to create (exist in snapshot but not in remote) */
  creates: string[];
  /** Tables to update (exist in both) */
  updates: string[];
  /** Tables to delete (exist in remote but not in snapshot) */
  deletes: string[];
}

/**
 * Compare snapshot tables with existing remote table names
 * @param {SchemaSnapshot} snapshot - Schema snapshot
 * @param {ReadonlySet<string>} existingTableNames - Set of existing table names in remote
 * @returns {SnapshotTypeComparison} Comparison result
 */
export function compareSnapshotWithRemote(
  snapshot: SchemaSnapshot,
  existingTableNames: ReadonlySet<string>,
): SnapshotTypeComparison {
  const snapshotTableNames = new Set(Object.keys(snapshot.tables));

  const creates: string[] = [];
  const updates: string[] = [];
  const deletes: string[] = [];

  // Tables in snapshot
  for (const tableName of snapshotTableNames) {
    if (existingTableNames.has(tableName)) {
      updates.push(tableName);
    } else {
      creates.push(tableName);
    }
  }

  // Tables only in remote (to be deleted)
  for (const tableName of existingTableNames) {
    if (!snapshotTableNames.has(tableName)) {
      deletes.push(tableName);
    }
  }

  return { creates, updates, deletes };
}

/**
 * Convert snapshot GQL permission policies to the proto request shape.
 * @param permission - Snapshot GQL permission policies
 * @returns Proto GQL permission
 */
export function protoGqlPermission(
  permission: SnapshotGqlPermission,
): MessageInitShape<typeof TailorDBGQLPermissionSchema> {
  return {
    policies: permission.map((policy) => protoGqlPolicy(policy)),
  };
}

function protoGqlPolicy(
  policy: SnapshotGqlPermissionPolicy,
): MessageInitShape<typeof TailorDBGQLPermission_PolicySchema> {
  const actions: TailorDBGQLPermission_Action[] = [];
  for (const action of policy.actions) {
    switch (action) {
      case "all":
        actions.push(TailorDBGQLPermission_Action.ALL);
        break;
      case "create":
        actions.push(TailorDBGQLPermission_Action.CREATE);
        break;
      case "read":
        actions.push(TailorDBGQLPermission_Action.READ);
        break;
      case "update":
        actions.push(TailorDBGQLPermission_Action.UPDATE);
        break;
      case "delete":
        actions.push(TailorDBGQLPermission_Action.DELETE);
        break;
      case "aggregate":
        actions.push(TailorDBGQLPermission_Action.AGGREGATE);
        break;
      case "bulkUpsert":
        actions.push(TailorDBGQLPermission_Action.BULK_UPSERT);
        break;
      default:
        throw new Error(`Unknown action: ${action satisfies never}`);
    }
  }
  let permit: TailorDBGQLPermission_Permit;
  switch (policy.permit) {
    case "allow":
      permit = TailorDBGQLPermission_Permit.ALLOW;
      break;
    case "deny":
      permit = TailorDBGQLPermission_Permit.DENY;
      break;
    default:
      throw new Error(`Unknown permission: ${policy.permit satisfies never}`);
  }
  return {
    conditions: policy.conditions.map((cond) => protoGqlCondition(cond)),
    actions,
    permit,
    description: policy.description,
  };
}

function protoGqlCondition(
  condition: SnapshotPermissionCondition,
): MessageInitShape<typeof TailorDBGQLPermission_ConditionSchema> {
  const [left, operator, right] = condition;

  const l = protoGqlOperand(left);
  const r = protoGqlOperand(right);
  let op: TailorDBGQLPermission_Operator;
  switch (operator) {
    case "eq":
      op = TailorDBGQLPermission_Operator.EQ;
      break;
    case "ne":
      op = TailorDBGQLPermission_Operator.NE;
      break;
    case "in":
      op = TailorDBGQLPermission_Operator.IN;
      break;
    case "nin":
      op = TailorDBGQLPermission_Operator.NIN;
      break;
    case "hasAny":
      op = TailorDBGQLPermission_Operator.HAS_ANY;
      break;
    case "nhasAny":
      op = TailorDBGQLPermission_Operator.NHAS_ANY;
      break;
    default:
      throw new Error(`Unknown operator: ${operator satisfies never}`);
  }
  return {
    left: l,
    operator: op,
    right: r,
  };
}

function protoGqlOperand(
  operand: SnapshotPermissionOperand,
): MessageInitShape<typeof TailorDBGQLPermission_OperandSchema> {
  if (isSnapshotFieldRefOperand(operand)) {
    if ("user" in operand) {
      return { kind: { case: "userField", value: operand.user } };
    }
    throw new Error(
      `Unsupported field-ref operand in GQL permission: ${JSON.stringify(operand)} ` +
        `— GQL permissions only support { user } field references`,
    );
  }

  return {
    kind: { case: "value", value: fromJson(ValueSchema, operand) },
  };
}
