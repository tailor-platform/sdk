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

  /**
   * Generate enum constant definitions from collected metadata.
   */
  static async generateEnumConstants(
    types: Record<string, EnumConstantMetadata>,
  ): Promise<string> {
    const allEnums = new Map<string, EnumConstantMetadata["enums"][number]>();

    for (const typeMetadata of Object.values(types)) {
      if (typeMetadata.enums) {
        for (const enumDef of typeMetadata.enums) {
          allEnums.set(enumDef.name, enumDef);
        }
      }
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
            const propertyDocs = e.values
              .filter((v) => v.description)
              .map((v) => {
                const key = v.value.replace(/[-\s]/g, "_");
                return ` * @property ${key} - ${v.description}`;
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

    if (!enumDefs) {
      return "";
    }

    return enumDefs + "\n";
  }

  private static capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
