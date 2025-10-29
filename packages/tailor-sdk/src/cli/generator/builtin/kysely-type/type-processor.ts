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
    const typeDef = this.generateTableInterface(type);

    return {
      name: type.name,
      typeDef,
    };
  }

  /**
   * Generate the table interface.
   */
  private static generateTableInterface(type: ParsedTailorDBType): string {
    const fields: string[] = ["id: Generated<string>;"];
    for (const [fieldName, parsedField] of Object.entries(type.fields)) {
      if (fieldName === "id") {
        continue;
      }

      const fieldType = this.generateFieldType(parsedField.config);
      fields.push(`${fieldName}: ${fieldType};`);
    }

    return multiline /* ts */ `
      ${type.name}: {
        ${fields.join("\n")}
      }
    `;
  }

  /**
   * Generate the complete field type including array and null modifiers.
   */
  private static generateFieldType(fieldConfig: FieldConfig): string {
    const baseType = this.getBaseType(fieldConfig);
    const isArray = fieldConfig.array === true;
    const isNullable = fieldConfig.required !== true;
    const isAssertNonNull = fieldConfig.assertNonNull === true;

    let finalType = baseType;
    if (isArray) {
      finalType = `${baseType}[]`;
    }
    if (isNullable) {
      if (isAssertNonNull) {
        finalType = `AssertNonNull<${finalType}>`;
      } else {
        finalType = `${finalType} | null`;
      }
    }

    return finalType;
  }

  /**
   * Get the base Kysely type for a field (without array/null modifiers).
   */
  private static getBaseType(fieldConfig: FieldConfig): string {
    const fieldType = fieldConfig.type;

    switch (fieldType) {
      case "uuid":
      case "string":
        return "string";
      case "integer":
      case "float":
        return "number";
      case "date":
      case "datetime":
        return "Timestamp";
      case "bool":
      case "boolean":
        return "boolean";
      case "enum":
        return this.getEnumType(fieldConfig);
      case "nested":
        return this.getNestedType(fieldConfig);
      default:
        return "string";
    }
  }

  /**
   * Get the enum type definition.
   */
  private static getEnumType(fieldConfig: FieldConfig): string {
    const allowedValues = fieldConfig.allowedValues;

    if (allowedValues && Array.isArray(allowedValues)) {
      return allowedValues
        .map((v: any) => {
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
  private static getNestedType(fieldConfig: FieldConfig): string {
    const fields = fieldConfig.fields;
    if (!fields || typeof fields !== "object") {
      return "string";
    }

    const fieldTypes: string[] = [];
    for (const [fieldName, nestedFieldConfig] of Object.entries(fields)) {
      const fieldType = this.generateFieldType(nestedFieldConfig);
      fieldTypes.push(`${fieldName}: ${fieldType}`);
    }

    return `{\n  ${fieldTypes.join(";\n  ")}${fieldTypes.length > 0 ? ";" : ""}\n}`;
  }

  static async processTypes(
    types: Record<string, KyselyTypeMetadata>,
    namespace: string,
  ): Promise<string> {
    return (
      [
        multiline /* ts */ `
          import { type ColumnType, Kysely } from "kysely";
          import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";

          type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
            ? ColumnType<S, I | undefined, U>
            : ColumnType<T, T | undefined, T>;
          type Timestamp = ColumnType<Date, Date | string, Date | string>;
          type AssertNonNull<T> = T extends ColumnType<infer S, infer I, infer U>
            ? ColumnType<NonNullable<S>, I | null, U | null>
            : ColumnType<NonNullable<T>, T | null, T | null>
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

    return `interface Namespace {\n  "${namespace}": {\n${typeDefsWithIndent}\n  }\n}`;
  }
}
