import { TailorDBType } from "@/services/tailordb/schema";
import { ManifestTypeMetadata, ManifestFieldMetadata } from "./types";
import { measure } from "@/performance";
import { tailorToManifestScalar } from "@/types/types";

export class TypeProcessor {
  /**
   * ネストしたフィールドを再帰的に処理
   */
  private static processNestedFields(objectFields: any): any {
    const nestedFields: any = {};

    Object.entries(objectFields).forEach(
      ([nestedFieldName, nestedFieldDef]: [string, any]) => {
        const nestedMetadata = nestedFieldDef.metadata;

        if (nestedMetadata.type === "nested" && nestedFieldDef.fields) {
          const deepNestedFields = TypeProcessor.processNestedFields(
            nestedFieldDef.fields,
          );
          nestedFields[nestedFieldName] = {
            Type: "nested",
            AllowedValues: nestedMetadata.allowedValues || [],
            Description: nestedMetadata.description || "",
            Validate: [],
            Required: nestedMetadata.required ?? true,
            Array: nestedMetadata.array ?? false,
            Index: false,
            Unique: false,
            ForeignKey: false,
            Vector: false,
            Fields: deepNestedFields,
          };
        } else {
          nestedFields[nestedFieldName] = {
            Type:
              tailorToManifestScalar[
                nestedMetadata.type as keyof typeof tailorToManifestScalar
              ] || nestedMetadata.type,
            AllowedValues: nestedMetadata.allowedValues || [],
            Description: nestedMetadata.description || "",
            Validate: [],
            Required: nestedMetadata.required ?? true,
            Array: nestedMetadata.array ?? false,
            Index: false,
            Unique: false,
            ForeignKey: false,
            Vector: false,
          };
        }
      },
    );

    return nestedFields;
  }

  @measure
  static async processType(type: TailorDBType): Promise<ManifestTypeMetadata> {
    const fields: ManifestFieldMetadata[] = Object.entries(type.fields).map(
      ([fieldName, fieldDef]) => {
        const typedFieldDef = fieldDef as any;
        const metadata = typedFieldDef.metadata;
        const fieldMetadata: ManifestFieldMetadata = {
          name: fieldName,
          description: metadata.description || "",
          type:
            tailorToManifestScalar[
              metadata.type as keyof typeof tailorToManifestScalar
            ] || "string",
          required: metadata.required ?? true,
          array: metadata.array ?? false,
        };

        if (metadata.type === "nested") {
          if (typedFieldDef.fields) {
            const objectFields = typedFieldDef.fields;
            const nestedFields =
              TypeProcessor.processNestedFields(objectFields);
            (fieldMetadata as any).Fields = nestedFields;
            fieldMetadata.type = "nested";
          }
        }

        return fieldMetadata;
      },
    );

    return {
      name: type.name,
      fields,
      isInput: false,
    };
  }

  @measure
  static async processTypes(
    types: TailorDBType[],
  ): Promise<Record<string, ManifestTypeMetadata>> {
    const result: Record<string, ManifestTypeMetadata> = {};

    for (const type of types) {
      const metadata = await this.processType(type);
      result[type.name] = metadata;
    }

    return result;
  }
}
