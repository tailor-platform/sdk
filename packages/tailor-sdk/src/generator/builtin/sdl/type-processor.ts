import { TailorDBType } from "@/services/tailordb/schema";
import { TailorType } from "@/types/type";
import { SDLTypeMetadata, SDLFieldMetadata } from "./types";
import { SDLUtils } from "./utils";
import { measure } from "@/performance";
import { tailorToGraphQL } from "@/types/types";

/**
 * Type処理ロジック
 * TailorType/TailorDBTypeからSDLTypeMetadataへの変換とSDL生成を担当
 */
export class TypeProcessor {
  /**
   * TailorDBTypeからSDLTypeMetadataに変換（統合版）
   * 直接メタデータを生成
   */
  @measure
  static async processDBType(type: TailorDBType): Promise<SDLTypeMetadata> {
    const fields: SDLFieldMetadata[] = [];

    // フィールドを処理
    for (const [fieldName, field] of Object.entries(type.fields)) {
      const fieldMetadata = (field as any).metadata;
      const ref = (field as any).reference;

      // 基本フィールド
      fields.push({
        name: fieldName,
        type: tailorToGraphQL[
          fieldMetadata.type as keyof typeof tailorToGraphQL
        ],
        required: fieldMetadata.required ?? true,
        array: fieldMetadata.array ?? false,
      });

      // 参照フィールド
      if (ref) {
        fields.push({
          name: ref.nameMap[0],
          type: ref.type.name,
          required: fieldMetadata.required ?? true,
          array: fieldMetadata.array ?? false,
        });
      }
    }

    return {
      name: type.name,
      fields,
      isInput: false,
    };
  }

  /**
   * TailorTypeからSDLTypeMetadataに変換（統合版）
   * 直接メタデータを生成
   */
  @measure
  static async processType(
    type: TailorType<any, any>,
    isInput: boolean = false,
    typeName?: string,
  ): Promise<SDLTypeMetadata> {
    const fields: SDLFieldMetadata[] = [];

    // フィールドを処理
    for (const [fieldName, field] of Object.entries(type.fields)) {
      const fieldMetadata = (field as any).metadata;
      const ref = (field as any).reference;

      // 基本フィールド
      fields.push({
        name: fieldName,
        type: tailorToGraphQL[
          fieldMetadata.type as keyof typeof tailorToGraphQL
        ],
        required: !!fieldMetadata.required,
        array: !!fieldMetadata.array,
      });

      // 参照フィールド
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
      name: typeName || "undefined",
      fields,
      isInput,
    };
  }

  /**
   * 汎用的な型処理メソッド（TailorType/TailorDBType両対応）
   */
  @measure
  static async processAnyType(
    type: TailorType<any, any> | TailorDBType,
  ): Promise<SDLTypeMetadata> {
    if (type instanceof TailorDBType) {
      return this.processDBType(type);
    }
    return this.processType(type);
  }

  /**
   * TailorDBTypeからSDL文字列を生成
   */
  @measure
  static async processTypeToSDL(type: TailorDBType): Promise<string> {
    const metadata = await this.processType(type);
    return SDLUtils.generateSDLFromMetadata(metadata);
  }

  /**
   * 複数のTailorDBTypeを処理してSDL文字列を生成
   */
  @measure
  static async processTypes(types: TailorDBType[]): Promise<string> {
    const metadataList: SDLTypeMetadata[] = [];

    for (const type of types) {
      const metadata = await this.processType(type);
      metadataList.push(metadata);
    }

    return SDLUtils.generateSDL(metadataList);
  }

  /**
   * TailorDBTypeの名前とメタデータのマップを作成
   */
  @measure
  static async processTypesToMap(
    types: Record<string, TailorDBType>,
  ): Promise<Record<string, SDLTypeMetadata>> {
    const result: Record<string, SDLTypeMetadata> = {};

    for (const [name, type] of Object.entries(types)) {
      result[name] = await this.processType(type);
    }

    return result;
  }

  /**
   * TailorDBTypeの配列から名前をキーとするマップを作成
   */
  @measure
  static async processTypeArrayToMap(
    types: TailorDBType[],
  ): Promise<Record<string, SDLTypeMetadata>> {
    const result: Record<string, SDLTypeMetadata> = {};

    for (const type of types) {
      const metadata = await this.processType(type);
      result[type.name] = metadata;
    }

    return result;
  }

  /**
   * 型の依存関係を解析（将来の拡張用）
   */
  static analyzeDependencies(metadata: SDLTypeMetadata): string[] {
    const dependencies: string[] = [];

    for (const field of metadata.fields) {
      // カスタム型の場合は依存関係として追加
      if (!this.isScalarType(field.type)) {
        dependencies.push(field.type);
      }
    }

    return [...new Set(dependencies)]; // 重複を除去
  }

  /**
   * スカラー型かどうかを判定
   */
  private static isScalarType(type: string): boolean {
    const scalarTypes = [
      "String",
      "Int",
      "Float",
      "Boolean",
      "ID",
      "JSON",
      "Date",
      "Time",
      "DateTime",
    ];
    return scalarTypes.includes(type);
  }
}
