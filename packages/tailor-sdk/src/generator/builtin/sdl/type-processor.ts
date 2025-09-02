import { TailorDBType } from "@/services/tailordb/schema";
import { TailorType } from "@/types/type";
import { SDLTypeMetadata, SDLFieldMetadata } from "./types";
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
        const required = objFieldMetadata.required ? "!" : "";
        objectTypeDefinition += `${indent}${objFieldName}: ${nestedObjectDef}${required}\n`;
      } else {
        const objFieldType =
          tailorToGraphQL[
            objFieldMetadata.type as keyof typeof tailorToGraphQL
          ];
        const required = objFieldMetadata.required ? "!" : "";
        const arrayWrapper = objFieldMetadata.array
          ? `[${objFieldType}${required}]!`
          : `${objFieldType}${required}`;
        objectTypeDefinition += `${indent}${objFieldName}: ${arrayWrapper}\n`;
      }
    }

    objectTypeDefinition += "  ".repeat(indentLevel - 1) + "}";
    return objectTypeDefinition;
  }
  static async processDBType(type: TailorDBType): Promise<SDLTypeMetadata> {
    return this.processType(type, false, type.name);
  }

  static async processType(
    type: TailorType<any, any> | TailorDBType,
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
        const isSelf = ref.type.name === typeName;
        const explicitSelf =
          (field as any)._pendingSelfRelation?.as !== undefined;
        if (!isSelf || explicitSelf) {
          fields.push({
            name: ref.nameMap?.[0],
            type: ref.type.name,
            required: !!fieldMetadata.required,
            array: !!fieldMetadata.array,
          });
        }
      }
    }

    // Add backward relations for unique (1-1) references only
    if ("referenced" in type && Object.keys(type.referenced ?? {}).length > 0) {
      Object.entries(type.referenced).forEach(
        ([backwardFieldName, [referencedType, refFieldName]]) => {
          const refField = referencedType.fields[refFieldName] as any;
          const isArray = !(refField.metadata?.unique ?? false);
          // Only include backward fields for self-referencing relations
          if (!isArray && referencedType.name === typeName) {
            fields.push({
              name: backwardFieldName,
              type: referencedType.name,
              required: false,
              array: false,
            });
          }
        },
      );
    }

    return {
      name: typeName,
      fields,
      isInput,
    };
  }
}
