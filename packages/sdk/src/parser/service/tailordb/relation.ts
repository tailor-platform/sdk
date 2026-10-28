import type { RawRelationConfig } from "#/configure/services/tailordb/types";
import type { OperatorFieldConfig } from "#/parser/service/tailordb/types";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "#/types/tailordb.generated";
import type { UnionToTuple } from "type-fest";

const relationTypes = {
  "1-1": "1-1",
  oneToOne: "1-1",
  "n-1": "n-1",
  manyToOne: "n-1",
  "N-1": "n-1",
  keyOnly: "keyOnly",
} as const;
export const relationTypesKeys = Object.keys(relationTypes) as UnionToTuple<
  keyof typeof relationTypes
>;

export interface RelationProcessingContext {
  tableName: string;
  fieldName: string;
  rawTypes: Readonly<Record<string, TailorDBTypeSchemaOutput>>;
}

export interface ProcessedRelationMetadata {
  index: boolean;
  foreignKey: boolean;
  relationType: string;
  unique: boolean;
  foreignKeyType: string;
  foreignKeyField: string;
}

export interface RelationInfo {
  targetType: string;
  forwardName: string;
  backwardName: string;
  key: string;
  unique: boolean;
}

function fieldRef(context: RelationProcessingContext): string {
  return `Field "${context.fieldName}" on table "${context.tableName}"`;
}

interface RelationTarget {
  table: string;
  key: string;
}

function relationTarget(
  rawRelation: RawRelationConfig,
  context: RelationProcessingContext,
): RelationTarget {
  return {
    table: rawRelation.toward.table === "self" ? context.tableName : rawRelation.toward.table,
    key: rawRelation.toward.key ?? "id",
  };
}

/**
 * Validate relation configuration.
 * @param rawRelation - Raw relation configuration from TailorDB table definition
 * @param fieldType - Type of the field that declares the relation
 * @param context - Context information for the relation (table name, field name, all raw tables)
 */
export function validateRelationConfig(
  rawRelation: RawRelationConfig,
  fieldType: string,
  context: RelationProcessingContext,
): void {
  // raw user config may omit the field
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (!rawRelation.type) {
    throw new Error(
      `${fieldRef(context)} has a relation but is missing the required 'type' property. ` +
        `Valid values: ${relationTypesKeys.join(", ")}.`,
    );
  }
  if (!(rawRelation.type in relationTypes)) {
    throw new Error(
      `${fieldRef(context)} has invalid relation type '${rawRelation.type}'. ` +
        `Valid values: ${relationTypesKeys.join(", ")}.`,
    );
  }

  const { table: targetTable, key } = relationTarget(rawRelation, context);
  const target = Object.hasOwn(context.rawTypes, targetTable)
    ? context.rawTypes[targetTable]
    : undefined;
  if (!target) {
    throw new Error(`${fieldRef(context)} references unknown table "${targetTable}".`);
  }

  const keyField = Object.hasOwn(target.fields, key) ? target.fields[key] : undefined;
  if (!keyField) {
    throw new Error(
      `${fieldRef(context)} references unknown field "${key}" on table "${targetTable}".`,
    );
  }
  if (keyField.type !== fieldType) {
    throw new Error(
      `${fieldRef(context)} is of type "${fieldType}", but the field it references, "${targetTable}.${key}", is of type "${keyField.type}". ` +
        `A relation needs both fields to have the same type.`,
    );
  }
}

/**
 * Process raw relation config and compute derived metadata values.
 * @param rawRelation - Raw relation configuration
 * @param context - Context information for the relation
 * @param isArrayField - Whether the target field is an array field
 * @returns Computed relation metadata to apply to field config
 */
export function processRelationMetadata(
  rawRelation: RawRelationConfig,
  context: RelationProcessingContext,
  isArrayField: boolean = false,
): ProcessedRelationMetadata {
  const isUnique = relationTypes[rawRelation.type] === "1-1";
  const { table: targetTypeName, key } = relationTarget(rawRelation, context);

  // Index and unique are not supported on array fields
  const shouldSetIndex = !isArrayField;
  const shouldSetUnique = !isArrayField && isUnique;

  return {
    index: shouldSetIndex,
    foreignKey: true,
    relationType: rawRelation.type,
    unique: shouldSetUnique,
    foreignKeyType: targetTypeName,
    foreignKeyField: key,
  };
}

/**
 * Build relation info for creating forward/backward relationships.
 * Returns undefined for keyOnly relations.
 * @param rawRelation - Raw relation configuration
 * @param context - Context information for the relation
 * @returns Relation information or undefined for keyOnly relations
 */
export function buildRelationInfo(
  rawRelation: RawRelationConfig,
  context: RelationProcessingContext,
): RelationInfo | undefined {
  // keyOnly relations don't create forward/backward relationships
  if (rawRelation.type === "keyOnly") {
    return undefined;
  }

  const isUnique = relationTypes[rawRelation.type] === "1-1";
  const { table: targetTypeName, key } = relationTarget(rawRelation, context);

  let forwardName = rawRelation.toward.as;
  if (!forwardName) {
    forwardName = context.fieldName.replace(/(ID|Id|id)$/u, "");
  }

  return {
    targetType: targetTypeName,
    forwardName,
    backwardName: rawRelation.backward ?? "",
    key,
    unique: isUnique,
  };
}

/**
 * Apply processed relation metadata to field config.
 * @param fieldConfig - Original operator field configuration
 * @param metadata - Processed relation metadata to apply
 * @returns Field config with relation metadata applied
 */
export function applyRelationMetadataToFieldConfig(
  fieldConfig: OperatorFieldConfig,
  metadata: ProcessedRelationMetadata,
): OperatorFieldConfig {
  return {
    ...fieldConfig,
    index: metadata.index,
    foreignKey: metadata.foreignKey,
    unique: metadata.unique,
    foreignKeyType: metadata.foreignKeyType,
    foreignKeyField: metadata.foreignKeyField,
  };
}

/**
 * Resolve the relations declared on the inner fields of an object field into foreign keys.
 * An inner field gets only the foreign key: no index, no unique constraint, and no forward or
 * backward relationship.
 * @param fieldConfig - Object field configuration
 * @param context - Context information of the object field
 * @returns Field config whose inner fields carry the foreign keys
 */
export function applyNestedRelationMetadata(
  fieldConfig: OperatorFieldConfig,
  context: RelationProcessingContext,
): OperatorFieldConfig {
  if (!fieldConfig.fields) return fieldConfig;
  const fields = Object.fromEntries(
    Object.entries(fieldConfig.fields).map(([name, inner]) => {
      if (!inner.rawRelation) return [name, inner];
      const innerContext = { ...context, fieldName: `${context.fieldName}.${name}` };
      validateRelationConfig(inner.rawRelation, inner.type, innerContext);
      const { foreignKey, foreignKeyType, foreignKeyField } = processRelationMetadata(
        inner.rawRelation,
        innerContext,
        inner.array,
      );
      return [name, { ...inner, foreignKey, foreignKeyType, foreignKeyField }];
    }),
  );
  return { ...fieldConfig, fields };
}
