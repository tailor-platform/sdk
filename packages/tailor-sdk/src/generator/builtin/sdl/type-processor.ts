import { TailorDBType } from "@/services/tailordb/schema";
import { TailorType } from "@/types/type";
import { SDLTypeMetadata, SDLFieldMetadata } from "./types";
import { measure } from "@/performance";
import { tailorToGraphQL } from "@/types/types";

export class TypeProcessor {
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
      const fieldMetadata = (field as any).metadata;
      const ref = (field as any).reference;

      fields.push({
        name: fieldName,
        type: tailorToGraphQL[
          fieldMetadata.type as keyof typeof tailorToGraphQL
        ],
        required: !!fieldMetadata.required,
        array: !!fieldMetadata.array,
      });

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
