import type { EnumConstantMetadata } from "./types";
import type { TailorDBTypeConfig } from "@/configure/services/tailordb/operator-types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

type FieldConfig = TailorDBTypeConfig["schema"]["fields"][string];

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
          values: parsedField.config.allowedValues
            .filter((v) => v.value !== undefined)
            .map((_valueObj) => ({
              value: _valueObj.value,
              description: _valueObj.description,
            })),
          fieldDescription: parsedField.config.description,
        });
      }

      if (parsedField.config.type === "nested" && parsedField.config.fields) {
        const nestedEnums = this.collectNestedEnums(
          parsedField.config.fields,
          type.name,
          fieldName,
        );
        enums.push(...nestedEnums);
      }
    }

    return enums;
  }

  private static collectNestedEnums(
    fields: Record<string, FieldConfig>,
    typeName: string,
    fieldPrefix: string,
  ): EnumConstantMetadata["enums"] {
    const enums: EnumConstantMetadata["enums"] = [];

    for (const [nestedFieldName, nestedFieldConfig] of Object.entries(fields)) {
      const fullFieldName = `${fieldPrefix}${this.capitalizeFirst(nestedFieldName)}`;

      if (
        nestedFieldConfig.type === "enum" &&
        nestedFieldConfig.allowedValues
      ) {
        const enumTypeName = `${typeName}${this.capitalizeFirst(fullFieldName)}`;
        enums.push({
          name: enumTypeName,
          values: nestedFieldConfig.allowedValues
            .filter((v) => v.value !== undefined)
            .map((_valueObj) => ({
              value: _valueObj.value,
              description: _valueObj.description,
            })),
          fieldDescription: nestedFieldConfig.description,
        });
      }

      if (nestedFieldConfig.type === "nested" && nestedFieldConfig.fields) {
        const deeperEnums = this.collectNestedEnums(
          nestedFieldConfig.fields,
          typeName,
          fullFieldName,
        );
        enums.push(...deeperEnums);
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
