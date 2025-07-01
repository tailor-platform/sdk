import { TailorDBType } from "@/services/tailordb/schema";
import { ManifestTypeMetadata, ManifestFieldMetadata } from "./types";
import { measure } from "@/performance";
import { tailorToManifestScalar } from "@/types/types";

export class TypeProcessor {
  @measure
  static async processType(type: TailorDBType): Promise<ManifestTypeMetadata> {
    // TailorDBTypeから直接Manifest用のメタデータを生成
    // SDL生成システムには依存しない
    const fields: ManifestFieldMetadata[] = Object.entries(type.fields).map(
      ([fieldName, fieldDef]) => {
        const metadata = (
          fieldDef as {
            metadata: {
              description?: string;
              type: string;
              required?: boolean;
              array?: boolean;
            };
          }
        ).metadata;
        return {
          name: fieldName,
          description: metadata.description || "",
          type:
            tailorToManifestScalar[
              metadata.type as keyof typeof tailorToManifestScalar
            ] || "String",
          required: metadata.required ?? true,
          array: metadata.array ?? false,
        };
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
