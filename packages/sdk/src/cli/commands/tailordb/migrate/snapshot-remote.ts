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
import {
  computeSourceScriptHash,
  extractSourceScriptHash,
} from "#/parser/service/tailordb/type-script";
import { assertDefined } from "#/utils/assert";
import { type DiffChange, SCHEMA_SNAPSHOT_VERSION } from "./diff-calculator";
import { compareSnapshots } from "./snapshot-comparison";
import { createSnapshotRecord, normalizeSchemaSnapshot } from "./snapshot-normalization";
import {
  SNAPSHOT_FIELD_BOOLEAN_PROPS,
  type NormalizedSchemaSnapshot,
  type SchemaSnapshot,
  type SnapshotActionPermission,
  type SnapshotFieldConfig,
  type SnapshotGqlAction,
  type SnapshotGqlPermission,
  type SnapshotPermissionOperand,
  type SnapshotPermissionOperator,
  type SnapshotIndexConfig,
  type SnapshotPermissionCondition,
  type SnapshotRecordPermission,
  type SnapshotRelationship,
  type SnapshotSettings,
  type TailorDBSnapshotType,
} from "./snapshot-types";
import type { SchemaDrift } from "./types";

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
  // Remote schemas do not expose field defaults, so optionalOnCreate is the
  // only signal when no field-level create hook carries the same contract.
  if (remoteField.optionalOnCreate && !config.hooks?.create) {
    config.optionalOnCreate = true;
  }

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

/**
 * Result of scanning a remote type's script expressions for an embedded
 * source hash: a single agreed-upon hash, no hash found at all (the pattern
 * left by a pre-v2 CLI deploy), or disagreeing hashes across expressions
 * (a distinct anomaly, not the pre-v2 pattern).
 */
type RemoteScriptHashState =
  | { kind: "hash"; hash: string }
  | { kind: "absent" }
  | { kind: "conflicting" };

function extractRemoteScriptHashState(remoteType: ProtoTailorDBType): RemoteScriptHashState {
  const exprs = [
    remoteType.schema?.typeHook?.create?.expr,
    remoteType.schema?.typeHook?.update?.expr,
    remoteType.schema?.typeValidate?.create?.expr,
    remoteType.schema?.typeValidate?.update?.expr,
  ];
  let found: string | undefined;
  for (const expr of exprs) {
    if (!expr) continue;
    const hash = extractSourceScriptHash(expr);
    if (!hash) continue;
    if (found && found !== hash) return { kind: "conflicting" };
    found = hash;
  }
  return found ? { kind: "hash", hash: found } : { kind: "absent" };
}

function remoteHasScripts(remoteType: ProtoTailorDBType): boolean {
  return !!(
    remoteType.schema?.typeHook?.create?.expr ||
    remoteType.schema?.typeHook?.update?.expr ||
    remoteType.schema?.typeValidate?.create?.expr ||
    remoteType.schema?.typeValidate?.update?.expr
  );
}

/**
 * Detail suffix used when a script-carrying table has no script hash on the
 * remote at all — the pattern left by an environment whose last deploy used
 * the pre-v2 CLI, which never wrote script hashes.
 */
export const MISSING_REMOTE_SCRIPT_HASH_SUFFIX = "has no script hash on remote";

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
      const remoteState = extractRemoteScriptHashState(remoteType);
      const remoteHash = remoteState.kind === "hash" ? remoteState.hash : undefined;
      if (localHash !== remoteHash) {
        const details =
          remoteState.kind === "hash"
            ? `Table '${tableName}' scripts differ between remote and snapshot`
            : remoteState.kind === "conflicting"
              ? `Table '${tableName}' has conflicting script hashes on remote`
              : remoteHasScripts(remoteType)
                ? `Table '${tableName}' ${MISSING_REMOTE_SCRIPT_HASH_SUFFIX}`
                : `Table '${tableName}' has scripts in snapshot but not on remote`;
        drifts.push({ tableName, kind: "script_mismatch", details });
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
  const {
    hooks: _hooks,
    validate: _validate,
    default: _default,
    optionalOnCreate: _optionalOnCreate,
    ...rest
  } = field;
  if (rest.fields) {
    const nested = createSnapshotRecord<SnapshotFieldConfig>();
    for (const [name, f] of Object.entries(rest.fields)) {
      nested[name] = stripFieldScriptProps(f);
    }
    return { ...rest, fields: nested };
  }
  return rest;
}

/**
 * Project a snapshot onto the shape comparable with remote-derived state:
 * system fields, script-bearing props (hooks, validate, default), and
 * type-level script expressions are stripped, since the platform stores them
 * in a transformed or unrepresented form.
 * @param {SchemaSnapshot} snapshot - Snapshot to project
 * @returns {NormalizedSchemaSnapshot} Normalized snapshot without script-bearing props
 */
export function createRemoteComparableSnapshot(snapshot: SchemaSnapshot): NormalizedSchemaSnapshot {
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
