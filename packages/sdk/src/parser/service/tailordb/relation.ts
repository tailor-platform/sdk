import * as inflection from "inflection";
import type { RawRelationConfig, OperatorFieldConfig } from "./types";

const relationTypes = {
  "1-1": "1-1",
  oneToOne: "1-1",
  "n-1": "n-1",
  manyToOne: "n-1",
  "N-1": "n-1",
  keyOnly: "keyOnly",
} as const;
export type RelationType = keyof typeof relationTypes;

export interface RelationProcessingContext {
  typeName: string;
  fieldName: string;
  allTypeNames: Set<string>;
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
  return `Field "${context.fieldName}" on type "${context.typeName}"`;
}

/**
 * Validate relation configuration.
 * @param {RawRelationConfig} rawRelation - Raw relation configuration from TailorDB type definition
 * @param {RelationProcessingContext} context - Context information for the relation (type name, field name, all type names)
 */
export function validateRelationConfig(
  rawRelation: RawRelationConfig,
  context: RelationProcessingContext,
): void {
  if (!rawRelation.type) {
    throw new Error(
      `${fieldRef(context)} has a relation but is missing the required 'type' property. ` +
        `Valid values: ${Object.keys(relationTypes).join(", ")}.`,
    );
  }
  if (!(rawRelation.type in relationTypes)) {
    throw new Error(
      `${fieldRef(context)} has invalid relation type '${rawRelation.type}'. ` +
        `Valid values: ${Object.keys(relationTypes).join(", ")}.`,
    );
  }

  // Validate target type exists (for non-self relations)
  if (rawRelation.toward.type !== "self" && !context.allTypeNames.has(rawRelation.toward.type)) {
    throw new Error(`${fieldRef(context)} references unknown type "${rawRelation.toward.type}".`);
  }
}

/**
 * Process raw relation config and compute derived metadata values.
 * @param {RawRelationConfig} rawRelation - Raw relation configuration
 * @param {RelationProcessingContext} context - Context information for the relation
 * @param {boolean} [isArrayField=false] - Whether the target field is an array field
 * @returns {ProcessedRelationMetadata} Computed relation metadata to apply to field config
 */
export function processRelationMetadata(
  rawRelation: RawRelationConfig,
  context: RelationProcessingContext,
  isArrayField: boolean = false,
): ProcessedRelationMetadata {
  const isUnique = relationTypes[rawRelation.type] === "1-1";
  const key = rawRelation.toward.key ?? "id";

  // Resolve target type name (handle "self" reference)
  const targetTypeName =
    rawRelation.toward.type === "self" ? context.typeName : rawRelation.toward.type;

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
 * @param {RawRelationConfig} rawRelation - Raw relation configuration
 * @param {RelationProcessingContext} context - Context information for the relation
 * @returns {RelationInfo | undefined} Relation information or undefined for keyOnly relations
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
  const key = rawRelation.toward.key ?? "id";

  // Resolve target type name (handle "self" reference)
  const targetTypeName =
    rawRelation.toward.type === "self" ? context.typeName : rawRelation.toward.type;

  // Compute forward name
  let forwardName = rawRelation.toward.as;
  if (!forwardName) {
    if (rawRelation.toward.type === "self") {
      // For self-relations, derive from field name by removing ID suffix
      forwardName = context.fieldName.replace(/(ID|Id|id)$/u, "");
    } else {
      // Use inflection to generate default forward name
      forwardName = inflection.camelize(targetTypeName, true);
    }
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
 * @param {OperatorFieldConfig} fieldConfig - Original operator field configuration
 * @param {ProcessedRelationMetadata} metadata - Processed relation metadata to apply
 * @returns {OperatorFieldConfig} Field config with relation metadata applied
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
