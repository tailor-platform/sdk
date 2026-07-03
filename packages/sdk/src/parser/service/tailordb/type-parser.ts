import * as inflection from "inflection";
import { isPluginGeneratedType } from "#/parser/service/tailordb/type-source";
import { parseFieldConfig } from "./field";
import { parsePermissions } from "./permission";
import {
  validateRelationConfig,
  processRelationMetadata,
  buildRelationInfo,
  applyRelationMetadataToFieldConfig,
} from "./relation";
import type { TailorDBField } from "#/configure/services/tailordb/types";
import type {
  TypeSourceInfo,
  ParsedField,
  ParsedRelationship,
  TailorDBType,
} from "#/parser/service/tailordb/types";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "#/types/tailordb.generated";

/**
 * Parse multiple TailorDB types, build relationships, and validate uniqueness.
 * This is the main entry point for parsing TailorDB types.
 * @param rawTypes - Raw TailorDB types keyed by name
 * @param namespace - TailorDB namespace name
 * @param typeSourceInfo - Optional type source information
 * @returns Parsed types
 */
export function parseTypes(
  rawTypes: Record<string, TailorDBTypeSchemaOutput>,
  namespace: string,
  typeSourceInfo?: TypeSourceInfo,
): Record<string, TailorDBType> {
  const types = createRecord<TailorDBType>();
  const allTypeNames = new Set(Object.keys(rawTypes));

  for (const [typeName, type] of Object.entries(rawTypes)) {
    types[typeName] = parseTailorDBType(type, allTypeNames, rawTypes, typeSourceInfo);
  }

  buildBackwardRelationships(types, namespace, typeSourceInfo);
  validatePluralFormUniqueness(types, namespace, typeSourceInfo);

  return types;
}

/**
 * Parse a TailorDBTypeSchemaOutput into a TailorDBType.
 * @param type - TailorDB type to parse
 * @param allTypeNames - Set of all TailorDB type names
 * @param rawTypes - All raw TailorDB types keyed by name
 * @param typeSourceInfo - Optional type source information
 * @returns Parsed TailorDB type
 */
function parseTailorDBType(
  type: TailorDBTypeSchemaOutput,
  allTypeNames: Set<string>,
  rawTypes: Record<string, TailorDBTypeSchemaOutput>,
  typeSourceInfo?: TypeSourceInfo,
): TailorDBType {
  const metadata = type.metadata;
  const pluralForm = metadata.settings?.pluralForm || inflection.pluralize(type.name);
  const typeLocation = formatTypeSourceLocation(getTypeSourceInfo(typeSourceInfo, type.name));

  const fields = createRecord<ParsedField>();
  const forwardRelationships = createRecord<ParsedRelationship>();

  for (const [fieldName, fieldDef] of Object.entries(type.fields) as [
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TailorDBField requires generic type parameters
    TailorDBField<any, any>,
  ][]) {
    const context = { typeName: type.name, fieldName, allTypeNames };
    let fieldConfig = parseFieldConfig(fieldDef, {
      typeName: type.name,
      fieldPath: [fieldName],
    });
    const rawRelation = fieldConfig.rawRelation;

    // Process relation if rawRelation is present
    if (rawRelation) {
      validateRelationConfig(rawRelation, context);

      // Validate that n-1/manyToOne relations cannot have explicit unique
      const isNToOne = ["n-1", "manyToOne", "N-1"].includes(rawRelation.type);
      if (isNToOne && fieldConfig.unique) {
        throw new Error(
          `Field "${fieldName}" on type "${type.name}": cannot set unique on n-1 (manyToOne) relation. ` +
            `Use 1-1 (oneToOne) relation instead, or remove the unique constraint.`,
        );
      }

      const relationMetadata = processRelationMetadata(rawRelation, context, fieldConfig.array);
      fieldConfig = applyRelationMetadataToFieldConfig(fieldConfig, relationMetadata);
    }

    // Validate that index/unique are not set on array fields
    if (fieldConfig.array && fieldConfig.index) {
      throw new Error(
        `Field "${fieldName}" on type "${type.name}": index cannot be set on array fields`,
      );
    }
    if (fieldConfig.array && fieldConfig.unique) {
      throw new Error(
        `Field "${fieldName}" on type "${type.name}": unique cannot be set on array fields`,
      );
    }

    const parsedField: ParsedField = { name: fieldName, config: fieldConfig };

    // Build relation info for forward/backward relationships
    const relationInfo = rawRelation ? buildRelationInfo(rawRelation, context) : undefined;
    if (relationInfo) {
      parsedField.relation = { ...relationInfo };
      const forwardName = relationInfo.forwardName;

      if (forwardName.length === 0) {
        throw new Error(
          `Forward relation name for field "${fieldName}" on type "${type.name}"${typeLocation} cannot be empty. ` +
            `Use the "as" option in .relation({ toward: { as: ... } }) to specify a non-empty name.`,
        );
      }

      const existingForward = forwardRelationships[forwardName];
      if (existingForward) {
        throw new Error(
          `Forward relation name "${forwardName}" on type "${type.name}"${typeLocation} is duplicated ` +
            `between fields "${existingForward.targetField}" and "${fieldName}". ` +
            `Use the "as" option in .relation({ toward: { as: ... } }) to specify a unique name.`,
        );
      }
      if (Object.hasOwn(type.fields, forwardName)) {
        const message =
          forwardName === fieldName
            ? `Forward relation name "${forwardName}" on type "${type.name}"${typeLocation} is the same as its own relation field "${fieldName}". ` +
              `Use the "as" option in .relation({ toward: { as: ... } }) to specify a different name.`
            : `Forward relation name "${forwardName}" from field "${fieldName}" on type "${type.name}"${typeLocation} ` +
              `conflicts with existing field "${forwardName}". ` +
              `Use the "as" option in .relation({ toward: { as: ... } }) to specify a different name.`;
        throw new Error(message);
      }
      if (Object.hasOwn(metadata.files, forwardName)) {
        throw new Error(
          `Forward relation name "${forwardName}" from field "${fieldName}" on type "${type.name}"${typeLocation} ` +
            `conflicts with files field "${forwardName}". ` +
            `Use the "as" option in .relation({ toward: { as: ... } }) to specify a different name.`,
        );
      }

      const targetType = rawTypes[relationInfo.targetType];
      forwardRelationships[forwardName] = {
        name: forwardName,
        targetType: relationInfo.targetType,
        targetField: fieldName,
        sourceField: relationInfo.key,
        isArray: false,
        description: targetType?.metadata.description || "",
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
    backwardRelationships: createRecord<ParsedRelationship>(),
    settings: metadata.settings ?? {},
    permissions: parsePermissions(metadata.permissions),
    indexes: metadata.indexes,
    files: metadata.files,
  };
}

/**
 * Build backward relationships between parsed types.
 * Also validates that backward relation names are unique within each type.
 * @param types - Parsed types
 * @param namespace - TailorDB namespace name
 * @param typeSourceInfo - Optional type source information
 */
function buildBackwardRelationships(
  types: Record<string, TailorDBType>,
  namespace: string,
  typeSourceInfo?: TypeSourceInfo,
): void {
  // Track backward name sources for duplicate detection
  // Map: targetTypeName -> backwardName -> array of source info
  const backwardNameSources: Record<
    string,
    Record<string, { sourceType: string; fieldName: string }[]>
  > = Object.create(null);

  // Initialize tracking for all types
  for (const typeName of Object.keys(types)) {
    backwardNameSources[typeName] = Object.create(null) as Record<
      string,
      { sourceType: string; fieldName: string }[]
    >;
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
          const typeBackwardNames = backwardNameSources[typeName];
          if (typeBackwardNames === undefined) {
            throw new Error(`backward name sources not initialized for type: ${typeName}`);
          }
          if (!typeBackwardNames[backwardName]) {
            typeBackwardNames[backwardName] = [];
          }
          const sources = typeBackwardNames[backwardName];
          if (sources === undefined) {
            throw new Error(`backward name sources entry not initialized for: ${backwardName}`);
          }
          sources.push({
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
    if (targetType === undefined) {
      throw new Error(`type not found: ${targetTypeName}`);
    }
    const targetTypeSourceInfo = getTypeSourceInfo(typeSourceInfo, targetTypeName);
    const targetLocation = formatTypeSourceLocation(targetTypeSourceInfo);

    for (const [backwardName, sources] of Object.entries(backwardNames)) {
      // Check for duplicate backward relation names
      if (sources.length > 1) {
        const sourceList = sources
          .map((s) => {
            const sourceInfo = getTypeSourceInfo(typeSourceInfo, s.sourceType);
            const location = formatTypeSourceLocation(sourceInfo);
            return `${s.sourceType}.${s.fieldName}${location}`;
          })
          .join(", ");
        errors.push(
          `Backward relation name "${backwardName}" on type "${targetTypeName}" is duplicated from: ${sourceList}. ` +
            `Use the "backward" option in .relation() to specify unique names.`,
        );
      }

      // Check for conflict with existing fields
      if (Object.hasOwn(targetType.fields, backwardName)) {
        const source = sources[0];
        if (source === undefined) {
          throw new Error(`no source found for backward name: ${backwardName}`);
        }
        const sourceInfo = getTypeSourceInfo(typeSourceInfo, source.sourceType);
        const sourceLocation = formatTypeSourceLocation(sourceInfo);
        errors.push(
          `Backward relation name "${backwardName}" from ${source.sourceType}.${source.fieldName}${sourceLocation} ` +
            `conflicts with existing field "${backwardName}" on type "${targetTypeName}"${targetLocation}. ` +
            `Use the "backward" option in .relation() to specify a different name.`,
        );
      }

      // Check for conflict with files fields
      if (targetType.files && Object.hasOwn(targetType.files, backwardName)) {
        const source = sources[0];
        if (source === undefined) {
          throw new Error(`no source found for backward name: ${backwardName}`);
        }
        const sourceInfo = getTypeSourceInfo(typeSourceInfo, source.sourceType);
        const sourceLocation = formatTypeSourceLocation(sourceInfo);
        errors.push(
          `Backward relation name "${backwardName}" from ${source.sourceType}.${source.fieldName}${sourceLocation} ` +
            `conflicts with files field "${backwardName}" on type "${targetTypeName}"${targetLocation}. ` +
            `Use the "backward" option in .relation() to specify a different name.`,
        );
      }

      if (Object.hasOwn(targetType.forwardRelationships, backwardName)) {
        const source = sources[0];
        if (source === undefined) {
          throw new Error(`no source found for backward name: ${backwardName}`);
        }
        const sourceInfo = getTypeSourceInfo(typeSourceInfo, source.sourceType);
        const sourceLocation = formatTypeSourceLocation(sourceInfo);
        errors.push(
          `Relation name "${backwardName}" on type "${targetTypeName}"${targetLocation} is used by both ` +
            `a forward relationship and a backward relationship from ${source.sourceType}.${source.fieldName}${sourceLocation}. ` +
            `Use the "as" option in .relation({ toward: { as: ... } }) or the "backward" option in .relation() to specify unique names.`,
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
 * @param types - Parsed types
 * @param namespace - TailorDB namespace name
 * @param typeSourceInfo - Optional type source information
 */
function validatePluralFormUniqueness(
  types: Record<string, TailorDBType>,
  namespace: string,
  typeSourceInfo?: TypeSourceInfo,
): void {
  const errors: string[] = [];

  // Check 1: Each type's singular and plural query names must be different
  for (const [, parsedType] of Object.entries(types)) {
    const singularQuery = inflection.camelize(parsedType.name, true);
    const pluralQuery = inflection.camelize(parsedType.pluralForm, true);

    if (singularQuery === pluralQuery) {
      const sourceInfo = getTypeSourceInfo(typeSourceInfo, parsedType.name);
      const location = formatTypeSourceLocation(sourceInfo);
      errors.push(
        `Type "${parsedType.name}"${location} has identical singular and plural query names "${singularQuery}". ` +
          `Use db.type(["${parsedType.name}", "UniquePluralForm"], {...}) to set a unique pluralForm.`,
      );
    }
  }

  // Check 2: All query names must be unique across types
  const queryNameToSource = new Map<string, { typeName: string; kind: string }[]>();

  for (const parsedType of Object.values(types)) {
    const singularQuery = inflection.camelize(parsedType.name, true);
    const pluralQuery = inflection.camelize(parsedType.pluralForm, true);

    const singularSources = queryNameToSource.get(singularQuery) ?? [];
    singularSources.push({
      typeName: parsedType.name,
      kind: "singular",
    });
    queryNameToSource.set(singularQuery, singularSources);

    if (singularQuery !== pluralQuery) {
      const pluralSources = queryNameToSource.get(pluralQuery) ?? [];
      pluralSources.push({
        typeName: parsedType.name,
        kind: "plural",
      });
      queryNameToSource.set(pluralQuery, pluralSources);
    }
  }

  const duplicates = [...queryNameToSource].filter(([, sources]) => sources.length > 1);

  for (const [queryName, sources] of duplicates) {
    const sourceList = sources
      .map((s) => {
        const sourceInfo = getTypeSourceInfo(typeSourceInfo, s.typeName);
        const location = formatTypeSourceLocation(sourceInfo);
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

function getTypeSourceInfo(
  typeSourceInfo: TypeSourceInfo | undefined,
  typeName: string,
): TypeSourceInfo[string] | undefined {
  return typeSourceInfo && Object.hasOwn(typeSourceInfo, typeName)
    ? typeSourceInfo[typeName]
    : undefined;
}

function formatTypeSourceLocation(sourceInfo: TypeSourceInfo[string] | undefined): string {
  if (!sourceInfo) {
    return "";
  }
  return isPluginGeneratedType(sourceInfo)
    ? ` (plugin: ${sourceInfo.pluginId})`
    : ` (${sourceInfo.filePath})`;
}

function createRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
