import type { EnumConstantMetadata, EnumDefinition } from "./types";
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

  /**
   * Generate enum constant definitions from collected metadata.
   */
  static generateUnifiedEnumConstants(allEnums: EnumDefinition[]): string {
    if (allEnums.length === 0) {
      return "";
    }

    const enumMap = new Map<string, EnumDefinition>();
    for (const enumDef of allEnums) {
      enumMap.set(enumDef.name, enumDef);
    }

    const enumDefs = Array.from(allEnums.values())
      .map((e) => {
        const members = e.values
          .map((v) => {
            const key = v.value.replace(/[-\s]/g, "_");
            return `  "${key}": "${v.value}"`;
          })
          .join(",\n");

        const hasDescriptions = e.values.some((v) => v.description);
        let jsDoc = "";
        if (e.fieldDescription || hasDescriptions) {
          const lines: string[] = [];

          if (e.fieldDescription) {
            lines.push(` * ${e.fieldDescription}`);
            if (hasDescriptions) {
              lines.push(" *");
            }
          }

          if (hasDescriptions) {
            const propertyDocs = e.values.map((v) => {
              const key = v.value.replace(/[-\s]/g, "_");
              return ` * @property ${[key, v.description].filter(Boolean).join(" - ")}`;
            });
            lines.push(...propertyDocs);
          }

          if (lines.length > 0) {
            jsDoc = `/**\n${lines.join("\n")}\n */\n`;
          }
        }

        const constDef = `${jsDoc}export const ${e.name} = {\n${members}\n} as const;`;
        const typeDef = `export type ${e.name} = (typeof ${e.name})[keyof typeof ${e.name}];`;
        return `${constDef}\n${typeDef}`;
      })
      .join("\n\n");

    return enumDefs;
  }

  private static capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
