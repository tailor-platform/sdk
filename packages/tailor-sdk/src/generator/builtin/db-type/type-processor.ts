import { type TailorDBType } from "@/services/tailordb/schema";
import { type DbTypeMetadata } from "./types";

/**
 * TailorDBTypeをTypeScript型定義に変換するプロセッサー
 */
export class TypeProcessor {
  /**
   * TailorDBTypeをDbTypeMetadataに変換
   */
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
    const refCfg = fieldDef.reference;
    const targetType = refCfg?.type?.name;
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

    // 1. The foreign key itself (retained with original type)
    const originalFieldType = this.getOriginalFieldType(fieldDef);
    fields.push(
      this.generateFieldDefinition(fieldName, originalFieldType, fieldDef),
    );

    // 2. Referenced object (using forward name from nameMap)
    const relationFieldName = refCfg?.nameMap?.[0];
    if (relationFieldName && relationFieldName !== fieldName) {
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
   * フィールド定義を生成（共通処理）
   */
  private static generateFieldDefinition(
    fieldName: string,
    fieldType: string,
    fieldDef: any,
  ): string {
    const metadata = fieldDef.metadata;
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
    const isArray = metadata?.array === true;

    // Detect relation fields (using field.reference)
    if (fieldDef.reference) {
      const targetType = fieldDef.reference.type?.name;
      if (targetType) {
        // Detect and handle circular references
        if (processing.has(targetType)) {
          return targetType; // Return only type name for circular references
        }
        return targetType;
      }
    }

    let baseType: string;
    switch (fieldType) {
      case "uuid":
      case "string":
        baseType = "string";
        break;
      case "integer":
      case "float":
        baseType = "number";
        break;
      case "bool":
      case "boolean":
        baseType = "boolean";
        break;
      case "date":
      case "datetime":
        baseType = "Date";
        break;
      case "enum": {
        const allowedValues =
          metadata?.allowedValues ||
          metadata?.values ||
          metadata?.enum ||
          fieldDef?.allowedValues ||
          fieldDef?.values ||
          fieldDef?.enum;

        if (allowedValues && Array.isArray(allowedValues)) {
          baseType = allowedValues.map((v) => `"${v.value}"`).join(" | ");
        } else {
          baseType = "string";
        }
        break;
      }
      case "nested": {
        const fields = fieldDef.fields || fieldDef.fields;
        if (fields && typeof fields === "object") {
          baseType = this.processNestedObjectType(fields, 1, processing);
        } else {
          baseType = "object";
        }
        break;
      }
      default:
        baseType = "string";
    }

    return isArray ? `${baseType}[]` : baseType;
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
      const isArray = nestedMetadata?.array === true;

      if (nestedMetadata.type === "nested" && (nestedFieldDef as any).fields) {
        let nestedObjectType = this.processNestedObjectType(
          (nestedFieldDef as any).fields,
          indentLevel + 1,
          processing,
        );
        if (isArray) {
          nestedObjectType = `${nestedObjectType}[]`;
        }
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
