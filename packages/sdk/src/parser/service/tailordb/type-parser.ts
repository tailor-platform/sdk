import * as inflection from "inflection";
import { parseFieldConfig } from "./field";
import { parsePermissions } from "./permission";
import {
  validateRelationConfig,
  processRelationMetadata,
  buildRelationInfo,
  applyRelationMetadataToFieldConfig,
} from "./relation";
import { ensureNoExternalVariablesInFieldScripts } from "./tailordb-field-script-external-var-guard";
import type {
  TailorDBType,
  TailorDBField,
  ParsedTailorDBType,
  ParsedField,
  ParsedRelationship,
} from "./types";

export type TypeSourceInfo = Record<string, { filePath: string; exportName: string }>;

/**
 * Parse multiple TailorDB types, build relationships, and validate uniqueness.
 * This is the main entry point for parsing TailorDB types.
 */
export function parseTypes(
  rawTypes: Record<string, TailorDBType>,
  namespace: string,
  typeSourceInfo?: TypeSourceInfo,
): Record<string, ParsedTailorDBType> {
  const types: Record<string, ParsedTailorDBType> = {};
  const allTypeNames = new Set(Object.keys(rawTypes));

  for (const [typeName, type] of Object.entries(rawTypes)) {
    types[typeName] = parseTailorDBType(type, allTypeNames, rawTypes);
  }

  buildBackwardRelationships(types, namespace, typeSourceInfo);
  validatePluralFormUniqueness(types, namespace, typeSourceInfo);

  return types;
}

/**
 * Parse a TailorDBType into a ParsedTailorDBType.
 */
function parseTailorDBType(
  type: TailorDBType,
  allTypeNames: Set<string>,
  rawTypes: Record<string, TailorDBType>,
): ParsedTailorDBType {
  const metadata = type.metadata;

  const pluralForm = metadata.settings?.pluralForm || inflection.pluralize(type.name);

  const fields: Record<string, ParsedField> = {};
  const forwardRelationships: Record<string, ParsedRelationship> = {};

  for (const [fieldName, fieldDef] of Object.entries(type.fields) as [
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TailorDBField requires generic type parameters
    TailorDBField<any, any>,
  ][]) {
    let fieldConfig = parseFieldConfig(fieldDef);
    const rawRelation = fieldConfig.rawRelation;
    const context = { typeName: type.name, fieldName, allTypeNames };

    // Process relation if rawRelation is present
    if (rawRelation) {
      validateRelationConfig(rawRelation, context);
      const relationMetadata = processRelationMetadata(rawRelation, context);
      fieldConfig = applyRelationMetadataToFieldConfig(fieldConfig, relationMetadata);
    }

    ensureNoExternalVariablesInFieldScripts(type.name, fieldName, fieldConfig);

    const parsedField: ParsedField = { name: fieldName, config: fieldConfig };

    // Build relation info for forward/backward relationships
    const relationInfo = rawRelation ? buildRelationInfo(rawRelation, context) : undefined;
    if (relationInfo) {
      parsedField.relation = { ...relationInfo };

      const targetType = rawTypes[relationInfo.targetType];
      forwardRelationships[relationInfo.forwardName] = {
        name: relationInfo.forwardName,
        targetType: relationInfo.targetType,
        targetField: fieldName,
        sourceField: relationInfo.key,
        isArray: false,
        description: targetType?.metadata?.description || "",
      };
    }

    fields[fieldName] = parsedField;
  }

  return {
    name: type.name,
    pluralForm,
    description: metadata.description,
    fields,
    forwardRelationships,
    backwardRelationships: {},
    settings: metadata.settings || {},
    permissions: parsePermissions(metadata.permissions || {}),
    indexes: metadata.indexes,
    files: metadata.files,
  };
}

/**
 * Build backward relationships between parsed types.
 * Also validates that backward relation names are unique within each type.
 */
function buildBackwardRelationships(
  types: Record<string, ParsedTailorDBType>,
  namespace: string,
  typeSourceInfo?: TypeSourceInfo,
): void {
  // Track backward name sources for duplicate detection
  // Map: targetTypeName -> backwardName -> array of source info
  const backwardNameSources: Record<
    string,
    Record<string, { sourceType: string; fieldName: string }[]>
  > = {};

  // Initialize tracking for all types
  for (const typeName of Object.keys(types)) {
    backwardNameSources[typeName] = {};
  }

  // Build backward relationships and track sources
  for (const [typeName, type] of Object.entries(types)) {
    for (const [otherTypeName, otherType] of Object.entries(types)) {
      for (const [fieldName, field] of Object.entries(otherType.fields)) {
        if (field.relation && field.relation.targetType === typeName) {
          let backwardName = field.relation.backwardName;

          if (!backwardName) {
            const lowerName = inflection.camelize(otherTypeName, true);
            backwardName = field.relation.unique
              ? inflection.singularize(lowerName)
              : inflection.pluralize(lowerName);
          }

          // Track the source of this backward name
          if (!backwardNameSources[typeName][backwardName]) {
            backwardNameSources[typeName][backwardName] = [];
          }
          backwardNameSources[typeName][backwardName].push({
            sourceType: otherTypeName,
            fieldName,
          });

          type.backwardRelationships[backwardName] = {
            name: backwardName,
            targetType: otherTypeName,
            targetField: fieldName,
            sourceField: field.relation.key,
            isArray: !field.relation.unique,
            description: otherType.description || "",
          };
        }
      }
    }
  }

  // Check for duplicates and collect errors
  const errors: string[] = [];

  for (const [targetTypeName, backwardNames] of Object.entries(backwardNameSources)) {
    const targetType = types[targetTypeName];
    const targetTypeSourceInfo = typeSourceInfo?.[targetTypeName];
    const targetLocation = targetTypeSourceInfo ? ` (${targetTypeSourceInfo.filePath})` : "";

    for (const [backwardName, sources] of Object.entries(backwardNames)) {
      // Check for duplicate backward relation names
      if (sources.length > 1) {
        const sourceList = sources
          .map((s) => {
            const sourceInfo = typeSourceInfo?.[s.sourceType];
            const location = sourceInfo ? ` (${sourceInfo.filePath})` : "";
            return `${s.sourceType}.${s.fieldName}${location}`;
          })
          .join(", ");
        errors.push(
          `Backward relation name "${backwardName}" on type "${targetTypeName}" is duplicated from: ${sourceList}. ` +
            `Use the "backward" option in .relation() to specify unique names.`,
        );
      }

      // Check for conflict with existing fields
      if (backwardName in targetType.fields) {
        const source = sources[0];
        const sourceInfo = typeSourceInfo?.[source.sourceType];
        const sourceLocation = sourceInfo ? ` (${sourceInfo.filePath})` : "";
        errors.push(
          `Backward relation name "${backwardName}" from ${source.sourceType}.${source.fieldName}${sourceLocation} ` +
            `conflicts with existing field "${backwardName}" on type "${targetTypeName}"${targetLocation}. ` +
            `Use the "backward" option in .relation() to specify a different name.`,
        );
      }

      // Check for conflict with files fields
      if (targetType.files && backwardName in targetType.files) {
        const source = sources[0];
        const sourceInfo = typeSourceInfo?.[source.sourceType];
        const sourceLocation = sourceInfo ? ` (${sourceInfo.filePath})` : "";
        errors.push(
          `Backward relation name "${backwardName}" from ${source.sourceType}.${source.fieldName}${sourceLocation} ` +
            `conflicts with files field "${backwardName}" on type "${targetTypeName}"${targetLocation}. ` +
            `Use the "backward" option in .relation() to specify a different name.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Backward relation name conflicts detected in TailorDB service "${namespace}".\n` +
        `${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
}

/**
 * Validate GraphQL query field name uniqueness.
 * Checks for:
 * 1. Each type's singular query name != plural query name
 * 2. No duplicate query names across all types
 */
function validatePluralFormUniqueness(
  types: Record<string, ParsedTailorDBType>,
  namespace: string,
  typeSourceInfo?: TypeSourceInfo,
): void {
  const errors: string[] = [];

  // Check 1: Each type's singular and plural query names must be different
  for (const [, parsedType] of Object.entries(types)) {
    const singularQuery = inflection.camelize(parsedType.name, true);
    const pluralQuery = inflection.camelize(parsedType.pluralForm, true);

    if (singularQuery === pluralQuery) {
      const sourceInfo = typeSourceInfo?.[parsedType.name];
      const location = sourceInfo ? ` (${sourceInfo.filePath})` : "";
      errors.push(
        `Type "${parsedType.name}"${location} has identical singular and plural query names "${singularQuery}". ` +
          `Use db.type(["${parsedType.name}", "UniquePluralForm"], {...}) to set a unique pluralForm.`,
      );
    }
  }

  // Check 2: All query names must be unique across types
  const queryNameToSource: Record<string, { typeName: string; kind: string }[]> = {};

  for (const parsedType of Object.values(types)) {
    const singularQuery = inflection.camelize(parsedType.name, true);
    const pluralQuery = inflection.camelize(parsedType.pluralForm, true);

    if (!queryNameToSource[singularQuery]) {
      queryNameToSource[singularQuery] = [];
    }
    queryNameToSource[singularQuery].push({
      typeName: parsedType.name,
      kind: "singular",
    });

    if (singularQuery !== pluralQuery) {
      if (!queryNameToSource[pluralQuery]) {
        queryNameToSource[pluralQuery] = [];
      }
      queryNameToSource[pluralQuery].push({
        typeName: parsedType.name,
        kind: "plural",
      });
    }
  }

  const duplicates = Object.entries(queryNameToSource).filter(([, sources]) => sources.length > 1);

  for (const [queryName, sources] of duplicates) {
    const sourceList = sources
      .map((s) => {
        const sourceInfo = typeSourceInfo?.[s.typeName];
        const location = sourceInfo ? ` (${sourceInfo.filePath})` : "";
        return `"${s.typeName}"${location} (${s.kind})`;
      })
      .join(", ");
    errors.push(`GraphQL query field "${queryName}" conflicts between: ${sourceList}`);
  }

  if (errors.length > 0) {
    throw new Error(
      `GraphQL field name conflicts detected in TailorDB service "${namespace}".\n` +
        `${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
}
