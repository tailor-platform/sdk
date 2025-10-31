import { type DbTypeMetadata } from "./types";
import type { TailorDBTypeConfig } from "@/configure/services/tailordb/operator-types";
import type {
  ParsedTailorDBType,
  ParsedField,
} from "@/parser/service/tailordb/types";

type FieldConfig = TailorDBTypeConfig["schema"]["fields"][string];

/**
 * TailorDBTypeをTypeScript型定義に変換するプロセッサー
 */
export class TypeProcessor {
  /**
   * ParsedTailorDBTypeをDbTypeMetadataに変換
   */
  static async processType(type: ParsedTailorDBType): Promise<DbTypeMetadata> {
    const typeDef = this.generateTypeDefinition(type, new Set());

    return {
      name: type.name,
      typeDef,
    };
  }

  /**
   * 複数の型を処理し、相互参照を解決
   */
  static async processTypes(
    types: Record<string, DbTypeMetadata>,
  ): Promise<string> {
    // Combine type definitions
    const typeDefs = Object.values(types)
      .map((type) => type.typeDef)
      .join("\n\n");

    return typeDefs + "\n";
  }

  /**
   * 型定義を生成（循環参照対応）
   */
  private static generateTypeDefinition(
    type: ParsedTailorDBType,
    processing: Set<string>,
  ): string {
    const fields: string[] = ["id: string;"];

    // Process regular fields
    for (const [fieldName, parsedField] of Object.entries(type.fields)) {
      if (fieldName === "id") {
        continue;
      }

      if (parsedField.relation) {
        // This field is a relation field
        const relationFields = this.generateRelationFieldsFromParsed(
          fieldName,
          parsedField,
          processing,
        );
        fields.push(...relationFields);
      } else {
        // Regular field
        const fieldType = this.mapFieldConfigToTypeScript(
          parsedField.config,
          processing,
        );
        const fieldDefinition = this.generateFieldDefinitionFromConfig(
          fieldName,
          fieldType,
          parsedField.config,
        );
        fields.push(fieldDefinition);
      }
    }

    // Add backward relationships (already parsed with inflection)
    for (const [relationName, rel] of Object.entries(
      type.backwardRelationships,
    )) {
      fields.push(
        `${relationName}?: ${rel.targetType}${rel.isArray ? "[]" : ""} | null;`,
      );
    }

    const fieldLines = fields.join("\n  ");
    const result = `export type ${type.name} = {
  ${fieldLines}
};`;

    return result;
  }

  /**
   * ParsedFieldからリレーションフィールドを生成
   */
  private static generateRelationFieldsFromParsed(
    fieldName: string,
    parsedField: ParsedField,
    processing: Set<string>,
  ): string[] {
    const fields: string[] = [];
    const relation = parsedField.relation;

    if (!relation) {
      // Not a relation, treat as regular field
      const fieldType = this.mapFieldConfigToTypeScript(
        parsedField.config,
        processing,
      );
      return [
        this.generateFieldDefinitionFromConfig(
          fieldName,
          fieldType,
          parsedField.config,
        ),
      ];
    }

    // 1. The foreign key itself
    const originalFieldType = this.getFieldTypeFromConfig(parsedField.config);
    fields.push(
      this.generateFieldDefinitionFromConfig(
        fieldName,
        originalFieldType,
        parsedField.config,
      ),
    );

    // 2. Referenced object (using forward name already generated via inflection in parser)
    const relationFieldName = relation.forwardName;
    if (relationFieldName && relationFieldName !== fieldName) {
      fields.push(
        this.generateFieldDefinitionFromConfig(
          relationFieldName,
          relation.targetType,
          parsedField.config,
        ),
      );
    }

    return fields;
  }

  /**
   * field configから型を取得
   */
  private static getFieldTypeFromConfig(fieldConfig: FieldConfig): string {
    const fieldType = fieldConfig?.type;
    switch (fieldType) {
      case "uuid":
      case "string":
        return "string";
      case "integer":
      case "float":
        return "number";
      case "boolean":
        return "boolean";
      case "date":
      case "datetime":
        return "Date";
      default:
        return "string";
    }
  }

  /**
   * field configからTypeScript型へマッピング
   */
  private static mapFieldConfigToTypeScript(
    fieldConfig: FieldConfig,
    processing: Set<string>,
  ): string {
    // Handle enum type
    if (
      fieldConfig.type === "enum" &&
      fieldConfig.allowedValues &&
      fieldConfig.allowedValues.length > 0
    ) {
      return fieldConfig.allowedValues
        .map((v: any) => {
          const value = typeof v === "string" ? v : v.value;
          return `"${value}"`;
        })
        .join(" | ");
    }

    // Handle nested object type
    if (fieldConfig.type === "nested" && fieldConfig.fields) {
      return this.processNestedObjectType(fieldConfig.fields, 1, processing);
    }

    return this.getFieldTypeFromConfig(fieldConfig);
  }

  /**
   * field configからフィールド定義を生成
   */
  private static generateFieldDefinitionFromConfig(
    fieldName: string,
    fieldType: string,
    fieldConfig: FieldConfig,
  ): string {
    const isRequired = fieldConfig.required === true;
    const isArray = fieldConfig.array || false;

    let typeDef = fieldType;
    if (isArray) {
      typeDef = `${fieldType}[]`;
    }

    const optionalMarker = isRequired ? "" : "?";
    const nullability = isRequired ? "" : " | null";

    return `${fieldName}${optionalMarker}: ${typeDef}${nullability};`;
  }

  /**
   * ネストしたオブジェクト型を再帰的に処理（fieldConfig形式）
   */
  private static processNestedObjectType(
    fields: Record<string, FieldConfig>,
    indentLevel: number,
    processing: Set<string>,
  ): string {
    const objectFields: string[] = [];

    for (const [fieldName, fieldConfig] of Object.entries(fields)) {
      let fieldType: string;

      // Handle nested type recursively
      if (fieldConfig.type === "nested" && fieldConfig.fields) {
        fieldType = this.processNestedObjectType(
          fieldConfig.fields,
          indentLevel + 1,
          processing,
        );
      } else {
        // Handle other types
        fieldType = this.mapFieldConfigToTypeScript(fieldConfig, processing);
      }

      // Generate field definition
      const fieldDefinition = this.generateFieldDefinitionFromConfig(
        fieldName,
        fieldType,
        fieldConfig,
      );
      objectFields.push(fieldDefinition);
    }

    const innerIndent = "  ".repeat(indentLevel + 1);
    return `{
${innerIndent}${objectFields.join(`\n${innerIndent}`)}
${"  ".repeat(indentLevel)}}`;
  }
}
