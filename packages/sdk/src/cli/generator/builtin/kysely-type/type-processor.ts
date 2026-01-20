import multiline from "multiline-ts";
import { type KyselyTypeMetadata, type KyselyNamespaceMetadata } from "./types";
import type { OperatorFieldConfig, ParsedTailorDBType } from "@/parser/service/tailordb/types";

/**
 * Processor that converts a ParsedTailorDBType into Kysely type metadata.
 */
export class TypeProcessor {
  /**
   * Convert a ParsedTailorDBType into KyselyTypeMetadata.
   * @param type - Parsed TailorDB type
   * @returns Generated Kysely type metadata
   */
  static async processType(type: ParsedTailorDBType): Promise<KyselyTypeMetadata> {
    const result = this.generateTableInterface(type);

    return {
      name: type.name,
      typeDef: result.typeDef,
      usedUtilityTypes: result.usedUtilityTypes,
    };
  }

  /**
   * Generate the table interface.
   * @param type - Parsed TailorDB type
   * @returns Table interface code and used utility types
   */
  private static generateTableInterface(type: ParsedTailorDBType): {
    typeDef: string;
    usedUtilityTypes: { Timestamp: boolean; Serial: boolean };
  } {
    const fieldEntries = Object.entries(type.fields).filter(([fieldName]) => fieldName !== "id");

    const fieldResults = fieldEntries.map(([fieldName, parsedField]) => ({
      fieldName,
      ...this.generateFieldType(parsedField.config),
    }));

    const fields = [
      "id: Generated<string>;",
      ...fieldResults.map((result) => `${result.fieldName}: ${result.type};`),
    ];

    const aggregatedUtilityTypes = fieldResults.reduce(
      (acc, result) => ({
        Timestamp: acc.Timestamp || result.usedUtilityTypes.Timestamp,
        Serial: acc.Serial || result.usedUtilityTypes.Serial,
      }),
      { Timestamp: false, Serial: false },
    );

    const typeDef = multiline /* ts */ `
      ${type.name}: {
        ${fields.join("\n")}
      }
    `;

    return { typeDef, usedUtilityTypes: aggregatedUtilityTypes };
  }

  /**
   * Generate the complete field type including array and null modifiers.
   * @param fieldConfig - Parsed field configuration
   * @returns Field type and used utility types
   */
  private static generateFieldType(fieldConfig: OperatorFieldConfig): {
    type: string;
    usedUtilityTypes: { Timestamp: boolean; Serial: boolean };
  } {
    const baseTypeResult = this.getBaseType(fieldConfig);
    const usedUtilityTypes = { ...baseTypeResult.usedUtilityTypes };

    const isArray = fieldConfig.array === true;
    const isNullable = fieldConfig.required !== true;

    let finalType = baseTypeResult.type;
    if (isArray) {
      // Wrap enum types in parentheses before adding array suffix
      const needsParens = fieldConfig.type === "enum";
      finalType = needsParens ? `(${baseTypeResult.type})[]` : `${baseTypeResult.type}[]`;
    }
    if (isNullable) {
      finalType = `${finalType} | null`;
    }

    if (fieldConfig.serial) {
      usedUtilityTypes.Serial = true;
      finalType = `Serial<${finalType}>`;
    }
    if (fieldConfig.hooks?.create) {
      finalType = `Generated<${finalType}>`;
    }

    return { type: finalType, usedUtilityTypes };
  }

  /**
   * Get the base Kysely type for a field (without array/null modifiers).
   * @param fieldConfig - Parsed field configuration
   * @returns Base field type and used utility types
   */
  private static getBaseType(fieldConfig: OperatorFieldConfig): {
    type: string;
    usedUtilityTypes: { Timestamp: boolean; Serial: boolean };
  } {
    const fieldType = fieldConfig.type;
    const usedUtilityTypes = { Timestamp: false, Serial: false };

    let type: string;
    switch (fieldType) {
      case "uuid":
      case "string":
        type = "string";
        break;
      case "integer":
      case "float":
        type = "number";
        break;
      case "date":
      case "datetime":
        usedUtilityTypes.Timestamp = true;
        type = "Timestamp";
        break;
      case "bool":
      case "boolean":
        type = "boolean";
        break;
      case "enum":
        type = this.getEnumType(fieldConfig);
        break;
      case "nested": {
        const nestedResult = this.getNestedType(fieldConfig);
        return nestedResult;
      }
      default:
        type = "string";
        break;
    }

    return { type, usedUtilityTypes };
  }

  /**
   * Get the enum type definition.
   * @param fieldConfig - Parsed field configuration
   * @returns Enum type definition
   */
  private static getEnumType(fieldConfig: OperatorFieldConfig): string {
    const allowedValues = fieldConfig.allowedValues;

    if (allowedValues && Array.isArray(allowedValues)) {
      return allowedValues
        .map((v: string | { value: string }) => {
          const value = typeof v === "string" ? v : v.value;
          return `"${value}"`;
        })
        .join(" | ");
    }
    return "string";
  }

  /**
   * Get the nested object type definition.
   * @param fieldConfig - Parsed field configuration
   * @returns Nested object type and used utility types
   */
  private static getNestedType(fieldConfig: OperatorFieldConfig): {
    type: string;
    usedUtilityTypes: { Timestamp: boolean; Serial: boolean };
  } {
    const fields = fieldConfig.fields;
    if (!fields || typeof fields !== "object") {
      return {
        type: "string",
        usedUtilityTypes: { Timestamp: false, Serial: false },
      };
    }

    const fieldResults = Object.entries(fields).map(([fieldName, nestedOperatorFieldConfig]) => ({
      fieldName,
      ...this.generateFieldType(nestedOperatorFieldConfig),
    }));

    const fieldTypes = fieldResults.map((result) => `${result.fieldName}: ${result.type}`);

    const aggregatedUtilityTypes = fieldResults.reduce(
      (acc, result) => ({
        Timestamp: acc.Timestamp || result.usedUtilityTypes.Timestamp,
        Serial: acc.Serial || result.usedUtilityTypes.Serial,
      }),
      { Timestamp: false, Serial: false },
    );

    const type = `{\n  ${fieldTypes.join(";\n  ")}${fieldTypes.length > 0 ? ";" : ""}\n}`;
    return { type, usedUtilityTypes: aggregatedUtilityTypes };
  }

  /**
   * Generate unified types file from multiple namespaces.
   * @param namespaceData - Namespace metadata
   * @returns Generated types file contents
   */
  static generateUnifiedTypes(namespaceData: KyselyNamespaceMetadata[]): string {
    if (namespaceData.length === 0) {
      return "";
    }

    // Aggregate used utility types from all namespaces
    const globalUsedUtilityTypes = namespaceData.reduce(
      (acc, ns) => ({
        Timestamp: acc.Timestamp || ns.usedUtilityTypes.Timestamp,
        Serial: acc.Serial || ns.usedUtilityTypes.Serial,
      }),
      { Timestamp: false, Serial: false },
    );

    const utilityTypeDeclarations: string[] = [];
    if (globalUsedUtilityTypes.Timestamp) {
      utilityTypeDeclarations.push(
        /* ts */ `type Timestamp = ColumnType<Date, Date | string, Date | string>;`,
      );
    }

    // Generated is always needed for the id field
    utilityTypeDeclarations.push(
      multiline /* ts */ `
        type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
          ? ColumnType<S, I | undefined, U>
          : ColumnType<T, T | undefined, T>;
      `,
    );
    if (globalUsedUtilityTypes.Serial) {
      utilityTypeDeclarations.push(
        /* ts */ `type Serial<T = string | number> = ColumnType<T, never, never>;`,
      );
    }

    const importsSection = multiline /* ts */ `
      import { type ColumnType, Kysely, type KyselyConfig } from "kysely";
      import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";

      ${utilityTypeDeclarations.join("\n")}
    `;

    // Generate Namespace interface with multiple namespaces
    const namespaceInterfaces = namespaceData
      .map(({ namespace, types }) => {
        const typeDefsWithIndent = types
          .map((type) => {
            return type.typeDef
              .split("\n")
              .map((line) => (line.trim() ? `    ${line}` : ""))
              .join("\n");
          })
          .join("\n\n");

        return `  "${namespace}": {\n${typeDefsWithIndent}\n  }`;
      })
      .join(",\n");

    const namespaceInterface = `export interface Namespace {\n${namespaceInterfaces}\n}`;

    const getDBFunction = multiline /* ts */ `
      export function getDB<const N extends keyof Namespace>(
        namespace: N,
        kyselyConfig?: Omit<KyselyConfig, "dialect">,
      ): Kysely<Namespace[N]> {
        const client = new tailordb.Client({ namespace });
        return new Kysely<Namespace[N]>({
          dialect: new TailordbDialect(client),
          ...kyselyConfig,
        });
      }

      export type DB<N extends keyof Namespace = keyof Namespace> = ReturnType<typeof getDB<N>>;
    `;

    return [importsSection, namespaceInterface, getDBFunction].join("\n\n") + "\n";
  }
}
