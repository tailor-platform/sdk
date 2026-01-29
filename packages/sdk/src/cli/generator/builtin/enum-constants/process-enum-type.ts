import type { EnumConstantMetadata } from "./types";
import type { NormalizedTailorDBType } from "@/parser/service/tailordb/types";

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function collectEnums(type: NormalizedTailorDBType): EnumConstantMetadata["enums"] {
  const enums: EnumConstantMetadata["enums"] = [];

  for (const [fieldName, parsedField] of Object.entries(type.fields)) {
    if (parsedField.config.type === "enum" && parsedField.config.allowedValues) {
      const enumTypeName = `${type.name}${capitalizeFirst(fieldName)}`;
      enums.push({
        name: enumTypeName,
        values: parsedField.config.allowedValues,
        fieldDescription: parsedField.config.description,
      });
    }

    // Process nested fields
    if (parsedField.config.type === "nested" && parsedField.config.fields) {
      for (const [nestedFieldName, nestedFieldConfig] of Object.entries(
        parsedField.config.fields,
      )) {
        if (nestedFieldConfig.type === "enum" && nestedFieldConfig.allowedValues) {
          const fullFieldName = `${fieldName}${capitalizeFirst(nestedFieldName)}`;
          const enumTypeName = `${type.name}${capitalizeFirst(fullFieldName)}`;
          enums.push({
            name: enumTypeName,
            values: nestedFieldConfig.allowedValues,
            fieldDescription: nestedFieldConfig.description,
          });
        }
      }
    }
  }

  return enums;
}

/**
 * Process a TailorDB type and extract enum metadata.
 * @param type - The parsed TailorDB type to process
 * @returns Enum constant metadata for the type
 */
export async function processEnumType(type: NormalizedTailorDBType): Promise<EnumConstantMetadata> {
  const enums = collectEnums(type);

  return {
    name: type.name,
    enums,
  };
}
