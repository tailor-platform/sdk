import * as inflection from "inflection";
import { parseFieldConfig } from "./field";
import { parsePermissions } from "./permission";
import { ensureNoExternalVariablesInFieldScripts } from "./tailordb-field-script-external-var-guard";
import type {
  TailorDBType,
  TailorDBField,
  ParsedTailorDBType,
  ParsedField,
  ParsedRelationship,
} from "./types";

/**
 * Parse a TailorDBType into a ParsedTailorDBType.
 * This is the main entry point for parsing TailorDB types in the parser layer.
 */
export function parseTailorDBType(type: TailorDBType): ParsedTailorDBType {
  const metadata = type.metadata;

  const pluralForm =
    metadata.settings?.pluralForm || inflection.pluralize(type.name);

  const fields: Record<string, ParsedField> = {};
  const forwardRelationships: Record<string, ParsedRelationship> = {};

  for (const [fieldName, fieldDef] of Object.entries(type.fields) as [
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TailorDBField requires generic type parameters
    TailorDBField<any, any>,
  ][]) {
    // Use parser function to convert field metadata to config
    const fieldConfig = parseFieldConfig(fieldDef);

    ensureNoExternalVariablesInFieldScripts(type.name, fieldName, fieldConfig);

    const parsedField: ParsedField = { name: fieldName, config: fieldConfig };

    const ref = fieldDef.reference;
    if (ref) {
      const targetType = ref.type?.name;
      if (targetType) {
        const forwardName =
          ref.nameMap?.[0] || inflection.camelize(targetType, true);
        const backwardName = ref.nameMap?.[1] || "";
        const key = ref.key || "id";
        const unique = fieldDef.metadata?.unique ?? false;

        parsedField.relation = {
          targetType,
          forwardName,
          backwardName,
          key,
          unique,
        };

        forwardRelationships[forwardName] = {
          name: forwardName,
          targetType,
          targetField: fieldName,
          sourceField: key,
          isArray: false,
          description: ref.type?.metadata?.description || "",
        };
      }
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
 */
export function buildBackwardRelationships(
  types: Record<string, ParsedTailorDBType>,
): void {
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
}
