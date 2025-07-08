import { TailorDBType } from "@/services/tailordb/schema";
import { measure } from "@/performance";
import { DbTypeMetadata } from "./types";

/**
 * TailorDBTypeをTypeScript型定義に変換するプロセッサー
 */
export class TypeProcessor {
  /**
   * TailorDBTypeをDbTypeMetadataに変換
   */
  @measure
  static async processType(type: TailorDBType): Promise<DbTypeMetadata> {
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
    // 型定義を結合
    const typeDefs = Object.values(types)
      .map((type) => type.typeDef)
      .join("\n\n");

    return typeDefs + "\n";
  }

  /**
   * 型定義を生成（循環参照対応）
   */
  private static generateTypeDefinition(
    type: TailorDBType,
    processing: Set<string>,
  ): string {
    const fields: string[] = ["id: string;"];

    for (const [fieldName, fieldDef] of Object.entries(type.fields)) {
      if (fieldName === "id") {
        continue;
      }

      if ((fieldDef as any).reference) {
        const relationFields = this.generateRelationFields(
          fieldName,
          fieldDef,
          processing,
        );
        fields.push(...relationFields);
      } else {
        const fieldType = this.mapFieldToTypeScript(fieldDef, processing);
        const fieldDefinition = this.generateFieldDefinition(
          fieldName,
          fieldType,
          fieldDef,
        );
        fields.push(fieldDefinition);
      }
    }
    Object.entries(type.referenced).forEach(
      ([backwardFieldName, [referencedType, fieldName]]) => {
        const refField = referencedType.fields[fieldName];
        const isArray = !(refField.metadata?.unique ?? false);
        fields.push(
          `${backwardFieldName}?: ${referencedType.name}${isArray ? "[]" : ""} | null;`,
        );
      },
    );

    const fieldLines = fields.join("\n  ");
    const result = `export type ${type.name} = {
  ${fieldLines}
};`;

    return result;
  }

  /**
   * リレーションフィールドから2つのフィールドを生成
   */
  private static generateRelationFields(
    fieldName: string,
    fieldDef: any,
    processing: Set<string>,
  ): string[] {
    const targetType = (fieldDef as any).reference?.type?.name;
    if (!targetType) {
      const fieldType = this.mapFieldToTypeScript(fieldDef, processing);
      const fieldDefinition = this.generateFieldDefinition(
        fieldName,
        fieldType,
        fieldDef,
      );
      return [fieldDefinition];
    }

    const fields: string[] = [];

    // 1. 外部キー自体（元の型で保持）
    const originalFieldType = this.getOriginalFieldType(fieldDef);
    fields.push(
      this.generateFieldDefinition(fieldName, originalFieldType, fieldDef),
    );

    // 2. 参照先オブジェクト（フィールド名から"ID"を除いた名前）
    const relationFieldName = fieldName.replace(/(ID|Id|id)$/, "");
    if (relationFieldName !== fieldName) {
      fields.push(
        this.generateFieldDefinition(relationFieldName, targetType, fieldDef),
      );
    }

    return fields;
  }

  /**
   * フィールドの元の型を取得（リレーション以外の型）
   */
  private static getOriginalFieldType(fieldDef: any): string {
    const metadata = fieldDef.metadata;
    const fieldType = metadata?.type;

    switch (fieldType) {
      case "uuid":
      case "string":
        return "string";
      case "integer":
      case "float":
        return "number";
      case "bool":
        return "boolean";
      case "date":
      case "datetime":
        return "Date";
      default:
        return "string";
    }
  }

  /**
   * フィールド定義を生成（共通処理）
   */
  private static generateFieldDefinition(
    fieldName: string,
    fieldType: string,
    fieldDef: any,
  ): string {
    const metadata = (fieldDef as any).metadata;
    const isRequired = metadata?.required === true;
    const assertNonNull = metadata?.assertNonNull === true;

    const optional = isRequired || assertNonNull;
    return `${fieldName}${optional ? "" : "?"}: ${fieldType}${optional ? "" : " | null"};`;
  }

  /**
   * フィールドをTypeScript型にマッピング
   */
  private static mapFieldToTypeScript(
    fieldDef: any,
    processing: Set<string>,
  ): string {
    const metadata = fieldDef.metadata;
    const fieldType = metadata?.type;

    // リレーションフィールドの検出（field.referenceを使用）
    if (fieldDef.reference) {
      const targetType = fieldDef.reference.type?.name;
      if (targetType) {
        // 循環参照の検出と対処
        if (processing.has(targetType)) {
          return targetType; // 循環参照の場合は型名のみ返す
        }
        return targetType;
      }
    }

    switch (fieldType) {
      case "uuid":
      case "string":
        return "string";
      case "integer":
      case "float":
        return "number";
      case "bool":
        return "boolean";
      case "date":
      case "datetime":
        return "Date";
      case "enum": {
        const allowedValues =
          metadata?.allowedValues ||
          metadata?.values ||
          metadata?.enum ||
          fieldDef?.allowedValues ||
          fieldDef?.values ||
          fieldDef?.enum;

        if (allowedValues && Array.isArray(allowedValues)) {
          return allowedValues.map((v) => `"${v.value}"`).join(" | ");
        }
        return "string";
      }
      case "nested": {
        const fields = fieldDef.fields || (fieldDef as any).fields;
        if (fields && typeof fields === "object") {
          return this.processNestedObjectType(fields, 1, processing);
        }
        return "object";
      }
      default:
        return "string";
    }
  }

  /**
   * ネストしたオブジェクト型を再帰的に処理
   */
  private static processNestedObjectType(
    fields: any,
    indentLevel: number,
    processing: Set<string>,
  ): string {
    const objectFields: string[] = [];

    for (const [fieldName, nestedFieldDef] of Object.entries(fields)) {
      const nestedMetadata = (nestedFieldDef as any).metadata;

      if (nestedMetadata.type === "nested" && (nestedFieldDef as any).fields) {
        const nestedObjectType = this.processNestedObjectType(
          (nestedFieldDef as any).fields,
          indentLevel + 1,
          processing,
        );
        objectFields.push(
          this.generateFieldDefinition(
            fieldName,
            nestedObjectType,
            nestedFieldDef,
          ),
        );
      } else {
        const fieldType = this.mapFieldToTypeScript(nestedFieldDef, processing);
        const fieldDefinition = this.generateFieldDefinition(
          fieldName,
          fieldType,
          nestedFieldDef as any,
        );
        objectFields.push(fieldDefinition);
      }
    }

    const innerIndent = "  ".repeat(indentLevel + 1);
    return `{
${innerIndent}${objectFields.join(`\n${innerIndent}`)}
${"  ".repeat(indentLevel)}}`;
  }
}
