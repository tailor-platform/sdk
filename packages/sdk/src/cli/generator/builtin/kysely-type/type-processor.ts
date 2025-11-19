import multiline from "multiline-ts";
import { type KyselyTypeMetadata } from "./types";
import type { TailorDBTypeConfig } from "@/configure/services/tailordb/operator-types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

type FieldConfig = TailorDBTypeConfig["schema"]["fields"][string];

/**
 * Processor that converts a ParsedTailorDBType into Kysely type metadata.
 */
export class TypeProcessor {
  /**
   * Convert a ParsedTailorDBType into KyselyTypeMetadata.
   */
  static async processType(
    type: ParsedTailorDBType,
  ): Promise<KyselyTypeMetadata> {
    const result = this.generateTableInterface(type);

    return {
      name: type.name,
      typeDef: result.typeDef,
      usedUtilityTypes: result.usedUtilityTypes,
    };
  }

  /**
   * Generate the table interface.
   */
  private static generateTableInterface(type: ParsedTailorDBType): {
    typeDef: string;
    usedUtilityTypes: { Timestamp: boolean; Serial: boolean };
  } {
    const fieldEntries = Object.entries(type.fields).filter(
      ([fieldName]) => fieldName !== "id",
    );

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
   */
  private static generateFieldType(fieldConfig: FieldConfig): {
    type: string;
    usedUtilityTypes: { Timestamp: boolean; Serial: boolean };
  } {
    const baseTypeResult = this.getBaseType(fieldConfig);
    const usedUtilityTypes = { ...baseTypeResult.usedUtilityTypes };

    const isArray = fieldConfig.array === true;
    const isNullable = fieldConfig.required !== true;

    let finalType = baseTypeResult.type;
    if (isArray) {
      finalType = `${baseTypeResult.type}[]`;
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
   */
  private static getBaseType(fieldConfig: FieldConfig): {
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
   */
  private static getEnumType(fieldConfig: FieldConfig): string {
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
   */
  private static getNestedType(fieldConfig: FieldConfig): {
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

    const fieldResults = Object.entries(fields).map(
      ([fieldName, nestedFieldConfig]) => ({
        fieldName,
        ...this.generateFieldType(nestedFieldConfig),
      }),
    );

    const fieldTypes = fieldResults.map(
      (result) => `${result.fieldName}: ${result.type}`,
    );

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

  static async processTypes(
    types: Record<string, KyselyTypeMetadata>,
    namespace: string,
  ): Promise<string> {
    // Aggregate used utility types from all types
    const aggregatedUtilityTypes = Object.values(types).reduce(
      (acc, type) => ({
        Timestamp: acc.Timestamp || type.usedUtilityTypes.Timestamp,
        Serial: acc.Serial || type.usedUtilityTypes.Serial,
      }),
      { Timestamp: false, Serial: false },
    );

    // Generate utility type declarations based on usage
    const utilityTypeDeclarations: string[] = [];
    if (aggregatedUtilityTypes.Timestamp) {
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
    if (aggregatedUtilityTypes.Serial) {
      utilityTypeDeclarations.push(
        /* ts */ `type Serial<T = string | number> = ColumnType<T, never, never>;`,
      );
    }

    return (
      [
        multiline /* ts */ `
          import { type ColumnType, Kysely } from "kysely";
          import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";

          ${utilityTypeDeclarations.join("\n")}
        `,
        TypeProcessor.generateNamespaceInterface(
          Object.values(types),
          namespace,
        ),
        multiline /* ts */ `
          export function getDB<const N extends keyof Namespace>(namespace: N): Kysely<Namespace[N]> {
            const client = new tailordb.Client({ namespace });
            return new Kysely<Namespace[N]>({ dialect: new TailordbDialect(client) });
          }

          export type DB<N extends keyof Namespace = keyof Namespace> = ReturnType<typeof getDB<N>>;
        `,
      ].join("\n\n") + "\n"
    );
  }

  /**
   * Generate the Namespace interface.
   */
  private static generateNamespaceInterface(
    types: KyselyTypeMetadata[],
    namespace: string,
  ): string {
    const typeDefsWithIndent = types
      .map((type) => {
        // Add 4 spaces indent to each line of typeDef
        return type.typeDef
          .split("\n")
          .map((line) => (line.trim() ? `    ${line}` : ""))
          .join("\n");
      })
      .join("\n\n");

    return `export interface Namespace {\n  "${namespace}": {\n${typeDefsWithIndent}\n  }\n}`;
  }
}
