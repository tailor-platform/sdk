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
 * Options for generating TailorDB type manifest from snapshot
 */
export interface GenerateManifestOptions {
  /** Whether to enable publishRecordEvents (default: false) */
  publishRecordEvents?: boolean;
  /** Default gqlOperations for the namespace */
  namespaceGqlOperations?: {
    create?: boolean;
    update?: boolean;
    delete?: boolean;
    read?: boolean;
  };
}

/**
 * Generate a TailorDB type manifest from a snapshot type
 * @param {TailorDBSnapshotType} snapshotType - Snapshot type to generate manifest from
 * @param {GenerateManifestOptions} options - Generation options
 * @returns {MessageInitShape<typeof TailorDBTypeSchema>} Type manifest
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
    bulkUpsert: snapshotType.settings?.bulkUpsert ?? false,
    draft: false,
    defaultQueryLimitSize: 100n,
    maxBulkUpsertSize: 1000n,
    pluralForm,
    // Read publishEvents from snapshot settings first, then fall back to options
    publishRecordEvents:
      snapshotType.settings?.publishEvents ?? options.publishRecordEvents ?? false,
  };

  // Apply gqlOperations from snapshot settings or namespace default
  const ops = snapshotType.settings?.gqlOperations ?? options.namespaceGqlOperations;
  if (ops) {
    defaultSettings.disableGqlOperations = {
      create: ops.create === false,
      update: ops.update === false,
      delete: ops.delete === false,
      read: ops.read === false,
    };
  }

  // Build fields
  const fields: Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>> = {};
  for (const [fieldName, fieldConfig] of Object.entries(snapshotType.fields)) {
    if (fieldName === "id") continue;
    fields[fieldName] = convertFieldConfigToProto(fieldConfig);
  }

  // Build relationships
  const relationships: Record<
    string,
    MessageInitShape<typeof TailorDBType_RelationshipConfigSchema>
  > = {};

  if (snapshotType.forwardRelationships) {
    for (const [relationName, rel] of Object.entries(snapshotType.forwardRelationships)) {
      relationships[relationName] = convertRelationshipToProto(rel, "forward");
    }
  }

  if (snapshotType.backwardRelationships) {
    for (const [relationName, rel] of Object.entries(snapshotType.backwardRelationships)) {
      relationships[relationName] = convertRelationshipToProto(rel, "backward");
    }
  }

  // Build indexes
  const indexes: Record<string, MessageInitShape<typeof TailorDBType_IndexSchema>> = {};
  if (snapshotType.indexes) {
    for (const [indexName, indexConfig] of Object.entries(snapshotType.indexes)) {
      indexes[indexName] = convertIndexToProto(indexConfig);
    }
  }

  // Build files
  const files: Record<string, MessageInitShape<typeof TailorDBType_FileConfigSchema>> = {};
  if (snapshotType.files) {
    for (const [fileName, description] of Object.entries(snapshotType.files)) {
      files[fileName] = { description: description || "" };
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

  // Field hooks/validators are aggregated into type-level scripts so that a
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
      relationships,
      settings: defaultSettings,
      extends: false,
      directives: [],
      indexes,
      files,
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
  const nestedFields: Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>> = {};

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldConfig.type === "nested" && fieldConfig.fields) {
      const deepNestedFields = processNestedFieldsFromSnapshot(fieldConfig.fields);
      nestedFields[fieldName] = {
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
      };
    } else {
      nestedFields[fieldName] = {
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
      };
    }
  }

  return nestedFields;
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
function convertIndexToProto(
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
 * Options for generating all type manifests from a snapshot
 */
export interface GenerateAllManifestsOptions extends GenerateManifestOptions {
  /** Set of type names that should have publishRecordEvents enabled */
  executorUsedTypes?: ReadonlySet<string>;
}

/**
 * Generate all TailorDB type manifests from a schema snapshot
 * @param {SchemaSnapshot} snapshot - Schema snapshot
 * @param {GenerateAllManifestsOptions} options - Generation options
 * @returns {Map<string, MessageInitShape<typeof TailorDBTypeSchema>>} Map of type name to manifest
 */
export function generateAllTypeManifestsFromSnapshot(
  snapshot: SchemaSnapshot,
  options: GenerateAllManifestsOptions = {},
): Map<string, MessageInitShape<typeof TailorDBTypeSchema>> {
  const manifests = new Map<string, MessageInitShape<typeof TailorDBTypeSchema>>();
  const { executorUsedTypes, ...baseOptions } = options;

  for (const [typeName, snapshotType] of Object.entries(snapshot.types)) {
    // Validate: if executor uses this type, publishEvents must not be explicitly false
    if (executorUsedTypes?.has(typeName) && snapshotType.settings?.publishEvents === false) {
      throw new Error(
        `Type "${typeName}" has publishEvents set to false, but it is used by an executor with a record trigger. ` +
          `Either remove the publishEvents: false setting or remove the executor trigger for this type.`,
      );
    }

    // Determine publishRecordEvents:
    // - If user explicitly sets a value (true or false), respect that (validation above ensures no executor conflict)
    // - If not set, check if executor uses this type (true if yes)
    // - Fall back to base options or default to false
    let publishRecordEvents: boolean;
    if (snapshotType.settings?.publishEvents !== undefined) {
      publishRecordEvents = snapshotType.settings.publishEvents;
    } else if (executorUsedTypes?.has(typeName)) {
      publishRecordEvents = true;
    } else {
      publishRecordEvents = baseOptions.publishRecordEvents ?? false;
    }
    const typeOptions: GenerateManifestOptions = {
      ...baseOptions,
      publishRecordEvents,
    };
    manifests.set(typeName, generateTailorDBTypeManifestFromSnapshot(snapshotType, typeOptions));
  }

  return manifests;
}

/**
 * Result of comparing snapshot types with existing remote types
 */
export interface SnapshotTypeComparison {
  /** Types to create (exist in snapshot but not in remote) */
  creates: string[];
  /** Types to update (exist in both) */
  updates: string[];
  /** Types to delete (exist in remote but not in snapshot) */
  deletes: string[];
}

/**
 * Compare snapshot types with existing remote type names
 * @param {SchemaSnapshot} snapshot - Schema snapshot
 * @param {ReadonlySet<string>} existingTypeNames - Set of existing type names in remote
 * @returns {SnapshotTypeComparison} Comparison result
 */
export function compareSnapshotWithRemote(
  snapshot: SchemaSnapshot,
  existingTypeNames: ReadonlySet<string>,
): SnapshotTypeComparison {
  const snapshotTypeNames = new Set(Object.keys(snapshot.types));

  const creates: string[] = [];
  const updates: string[] = [];
  const deletes: string[] = [];

  // Types in snapshot
  for (const typeName of snapshotTypeNames) {
    if (existingTypeNames.has(typeName)) {
      updates.push(typeName);
    } else {
      creates.push(typeName);
    }
  }

  // Types only in remote (to be deleted)
  for (const typeName of existingTypeNames) {
    if (!snapshotTypeNames.has(typeName)) {
      deletes.push(typeName);
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
