import * as inflection from "inflection";
import { isPluginGeneratedType } from "@/types/tailordb";
import { convertHookToExpr, parseFieldConfig, tailorUserMap } from "./field";
import { getPrecompiledScriptExpr } from "./hooks-validate-precompiled-expr";
import { parsePermissions } from "./permission";
import {
  validateRelationConfig,
  processRelationMetadata,
  buildRelationInfo,
  applyRelationMetadataToFieldConfig,
} from "./relation";
import type {
  TailorDBField,
  TypeSourceInfo,
  ParsedField,
  ParsedRelationship,
  TailorDBType,
  OperatorFieldHook,
  OperatorValidateConfig,
} from "@/types/tailordb";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "@/types/tailordb.generated";

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
  const types: Record<string, TailorDBType> = {};
  const allTypeNames = new Set(Object.keys(rawTypes));

  for (const [typeName, type] of Object.entries(rawTypes)) {
    types[typeName] = parseTailorDBType(type, allTypeNames, rawTypes);
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
 * @returns Parsed TailorDB type
 */
function parseTailorDBType(
  type: TailorDBTypeSchemaOutput,
  allTypeNames: Set<string>,
  rawTypes: Record<string, TailorDBTypeSchemaOutput>,
): TailorDBType {
  const metadata = type.metadata;
  const pluralForm = metadata.settings?.pluralForm || inflection.pluralize(type.name);

  const fields: Record<string, ParsedField> = {};
  const forwardRelationships: Record<string, ParsedRelationship> = {};

  const hasRecordHooks = Boolean(metadata.hooks?.create || metadata.hooks?.update);

  for (const [fieldName, fieldDef] of Object.entries(type.fields) as [
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TailorDBField requires generic type parameters
    TailorDBField<any, any>,
  ][]) {
    let fieldConfig = parseFieldConfig(fieldDef, { skipAutoHooks: hasRecordHooks });
    const rawRelation = fieldConfig.rawRelation;
    const context = { typeName: type.name, fieldName, allTypeNames };

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

  const recordHooks = convertRecordHooks(metadata.hooks);
  const recordValidate =
    metadata.validate && metadata.validate.length > 0
      ? convertRecordValidators(metadata.validate)
      : undefined;

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
    ...(recordHooks && { hooks: recordHooks }),
    ...(recordValidate && { validate: recordValidate }),
  };
}

/**
 * Convert record-level hooks to OperatorFieldHook with Script expressions.
 * The platform invokes these on create/update at the type level.
 * @param hooks - Record-level hook definitions
 * @returns Operator-form hooks ready for the apply pipeline, or undefined when empty
 */
function convertRecordHooks(
  hooks: NonNullable<TailorDBTypeSchemaOutput["metadata"]>["hooks"],
): OperatorFieldHook | undefined {
  if (!hooks) return undefined;
  const create = hooks.create
    ? { expr: convertHookToExpr(hooks.create as (...args: never[]) => unknown) }
    : undefined;
  const update = hooks.update
    ? { expr: convertHookToExpr(hooks.update as (...args: never[]) => unknown) }
    : undefined;
  if (!create && !update) return undefined;
  return { create, update };
}

/**
 * Convert record-level validators to OperatorValidateConfig[].
 * Record-level validators use { data, user } signature (no field-specific value).
 * The platform provides _data as the full record, so the same expression template works.
 * @param validators - Record-level validator definitions
 * @returns Parsed validate configs ready for the apply pipeline
 */
function convertRecordValidators(
  validators: NonNullable<TailorDBTypeSchemaOutput["metadata"]["validate"]>,
): OperatorValidateConfig[] {
  return validators.map((v) => {
    const { fn, message } =
      typeof v === "function"
        ? { fn: v, message: `failed by \`${v.toString().trim()}\`` }
        : { fn: v[0], message: v[1] as string };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const fnRef = fn as Function;
    return {
      script: {
        expr:
          getPrecompiledScriptExpr(fnRef as (...args: never[]) => unknown) ??
          `(${fnRef.toString().trim()})({ value: _value, data: _data, user: ${tailorUserMap} })`,
      },
      errorMessage: message,
    };
  });
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
    const targetLocation = targetTypeSourceInfo
      ? isPluginGeneratedType(targetTypeSourceInfo)
        ? ` (plugin: ${targetTypeSourceInfo.pluginId})`
        : ` (${targetTypeSourceInfo.filePath})`
      : "";

    for (const [backwardName, sources] of Object.entries(backwardNames)) {
      // Check for duplicate backward relation names
      if (sources.length > 1) {
        const sourceList = sources
          .map((s) => {
            const sourceInfo = typeSourceInfo?.[s.sourceType];
            const location = sourceInfo
              ? isPluginGeneratedType(sourceInfo)
                ? ` (plugin: ${sourceInfo.pluginId})`
                : ` (${sourceInfo.filePath})`
              : "";
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
        const sourceLocation = sourceInfo
          ? isPluginGeneratedType(sourceInfo)
            ? ` (plugin: ${sourceInfo.pluginId})`
            : ` (${sourceInfo.filePath})`
          : "";
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
        const sourceLocation = sourceInfo
          ? isPluginGeneratedType(sourceInfo)
            ? ` (plugin: ${sourceInfo.pluginId})`
            : ` (${sourceInfo.filePath})`
          : "";
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
      const sourceInfo = typeSourceInfo?.[parsedType.name];
      const location = sourceInfo
        ? isPluginGeneratedType(sourceInfo)
          ? ` (plugin: ${sourceInfo.pluginId})`
          : ` (${sourceInfo.filePath})`
        : "";
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
        const location = sourceInfo
          ? isPluginGeneratedType(sourceInfo)
            ? ` (plugin: ${sourceInfo.pluginId})`
            : ` (${sourceInfo.filePath})`
          : "";
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
