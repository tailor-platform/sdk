import type { EnumConstantMetadata } from "./types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

/**
 * Processor that collects enum fields and generates enum constants.
 */
export class EnumProcessor {
  static async processType(
    type: ParsedTailorDBType,
  ): Promise<EnumConstantMetadata> {
    const enums = this.collectEnums(type);

    return {
      name: type.name,
      enums,
    };
  }

  private static collectEnums(type: ParsedTailorDBType) {
    const enums: EnumConstantMetadata["enums"] = [];

    for (const [fieldName, parsedField] of Object.entries(type.fields)) {
      if (
        parsedField.config.type === "enum" &&
        parsedField.config.allowedValues
      ) {
        const enumTypeName = `${type.name}${this.capitalizeFirst(fieldName)}`;
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
          if (
            nestedFieldConfig.type === "enum" &&
            nestedFieldConfig.allowedValues
          ) {
            const fullFieldName = `${fieldName}${this.capitalizeFirst(nestedFieldName)}`;
            const enumTypeName = `${type.name}${this.capitalizeFirst(fullFieldName)}`;
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

  private static capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
