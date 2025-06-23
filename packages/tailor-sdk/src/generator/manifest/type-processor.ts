import { TailorDBType } from "../../services/tailordb/schema";
import { ManifestTypeMetadata, ManifestFieldMetadata } from "./types";
import { measure } from "../../performance";
import { tailorToManifestScalar } from "../../types/types";

/**
 * TailorDBType処理ロジック（Manifest生成専用）
 * SDL生成とは独立してManifest用のメタデータを生成
 */
export class TypeProcessor {
  /**
   * TailorDBTypeからManifest用メタデータを抽出
   */
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
      isInput: false, // TailorDBTypeは通常出力型
    };
  }

  /**
   * 複数のTailorDBTypeを処理
   */
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

  /**
   * 型の依存関係を解析（将来の拡張用）
   */
  static analyzeDependencies(metadata: ManifestTypeMetadata): string[] {
    const dependencies: string[] = [];

    for (const field of metadata.fields) {
      // カスタム型の場合は依存関係として追加
      if (!["String", "Int", "Float", "Boolean"].includes(field.type)) {
        dependencies.push(field.type);
      }
    }

    return [...new Set(dependencies)]; // 重複を除去
  }
}
