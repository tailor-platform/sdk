import { TailorDBType } from "@/services/tailordb/schema";
import { TailorType } from "@/types/type";
import { SDLTypeMetadata, SDLFieldMetadata } from "./types";
import { measure } from "@/performance";
import { tailorToGraphQL } from "@/types/types";

export class TypeProcessor {
  /**
   * ネストしたオブジェクトを再帰的に処理
   */
  private static processNestedObject(
    objectFields: any,
    indentLevel: number = 2,
  ): string {
    const indent = "  ".repeat(indentLevel);
    let objectTypeDefinition = "{\n";

    for (const [objFieldName, objField] of Object.entries(objectFields)) {
      const objFieldMetadata = (objField as any)._metadata;

      if (objFieldMetadata.type === "nested" && (objField as any).fields) {
        // さらにネストしたオブジェクトを再帰的に処理
        const nestedObjectDef = TypeProcessor.processNestedObject(
          (objField as any).fields,
          indentLevel + 1,
        );
        objectTypeDefinition += `${indent}${objFieldName}: ${nestedObjectDef}\n`;
      } else {
        const objFieldType =
          tailorToGraphQL[
            objFieldMetadata.type as keyof typeof tailorToGraphQL
          ];
        const required = objFieldMetadata.required ? "!" : "";
        objectTypeDefinition += `${indent}${objFieldName}: ${objFieldType}${required}\n`;
      }
    }

    objectTypeDefinition += "  ".repeat(indentLevel - 1) + "}";
    return objectTypeDefinition;
  }
  @measure
  static async processDBType(type: TailorDBType): Promise<SDLTypeMetadata> {
    return this.processType(type, false, type.name);
  }

  @measure
  static async processType(
    type: TailorType<any, any>,
    isInput: boolean = false,
    typeName: string,
  ): Promise<SDLTypeMetadata> {
    const fields: SDLFieldMetadata[] = [];

    for (const [fieldName, field] of Object.entries(type.fields)) {
      const fieldMetadata = (field as any)._metadata;
      const ref = (field as any).reference;

      if (fieldMetadata.type === "nested") {
        const objectFields = (field as any).fields;
        if (objectFields) {
          const objectTypeDefinition = TypeProcessor.processNestedObject(
            objectFields,
            2,
          );

          fields.push({
            name: fieldName,
            type: objectTypeDefinition,
            required: !!fieldMetadata.required,
            array: !!fieldMetadata.array,
          });
        } else {
          // fieldsが定義されていない場合はJSONとして処理
          fields.push({
            name: fieldName,
            type: tailorToGraphQL[
              fieldMetadata.type as keyof typeof tailorToGraphQL
            ],
            required: !!fieldMetadata.required,
            array: !!fieldMetadata.array,
          });
        }
      } else {
        fields.push({
          name: fieldName,
          type: tailorToGraphQL[
            fieldMetadata.type as keyof typeof tailorToGraphQL
          ],
          required: !!fieldMetadata.required,
          array: !!fieldMetadata.array,
        });
      }

      if (ref) {
        fields.push({
          name: ref.nameMap[0],
          type: ref.type.name,
          required: !!fieldMetadata.required,
          array: !!fieldMetadata.array,
        });
      }
    }

    return {
      name: typeName,
      fields,
      isInput,
    };
  }
}
