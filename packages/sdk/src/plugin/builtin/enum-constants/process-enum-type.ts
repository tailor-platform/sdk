import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { EnumConstantMetadata } from "./types";

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function collectEnums(
  type: TailorDBType,
  namespace: string | undefined,
): EnumConstantMetadata["enums"] {
  const enums: EnumConstantMetadata["enums"] = [];
  const namePrefix = namespace === undefined ? "" : namespaceIdentifier(namespace);
  const sourcePrefix = namespace === undefined ? "" : `${namespace}.`;

  for (const [fieldName, parsedField] of Object.entries(type.fields)) {
    if (parsedField.config.type === "enum" && parsedField.config.allowedValues) {
      const enumTypeName = `${namePrefix}${type.name}${capitalizeFirst(fieldName)}`;
      enums.push({
        name: enumTypeName,
        source: `${sourcePrefix}${type.name}.${fieldName}`,
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
          const enumTypeName = `${namePrefix}${type.name}${capitalizeFirst(fullFieldName)}`;
          enums.push({
            name: enumTypeName,
            source: `${sourcePrefix}${type.name}.${fieldName}.${nestedFieldName}`,
            values: nestedFieldConfig.allowedValues,
            fieldDescription: nestedFieldConfig.description,
          });
        }
      }
    }
  }

  return enums;
}

// A namespace name is lowercase letters, digits and hyphens, so `shop-db` becomes `ShopDb`; one
// starting with a digit gets a leading `_` to stay a valid identifier.
function namespaceIdentifier(namespace: string): string {
  const pascal = namespace.split("-").map(capitalizeFirst).join("");
  return /^[0-9]/.test(pascal) ? `_${pascal}` : pascal;
}

/**
 * Process a TailorDB table and extract enum metadata.
 * @param type - The parsed TailorDB table to process
 * @param namespace - Namespace to name the constants after, when several namespaces define the table's name
 * @returns Enum constant metadata for the table
 */
export async function processEnumType(
  type: TailorDBType,
  namespace?: string,
): Promise<EnumConstantMetadata> {
  const enums = collectEnums(type, namespace);

  return {
    name: type.name,
    enums,
  };
}
