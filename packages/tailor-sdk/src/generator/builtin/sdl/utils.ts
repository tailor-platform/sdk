import { SDLFieldMetadata, SDLTypeMetadata } from "./types";
import { measure } from "@/performance";

/**
 * SDL生成の共通ユーティリティ関数
 * GraphQL SDL文字列の生成とフォーマットを担当
 */
export class SDLUtils {
  /**
   * SDLTypeMetadataからGraphQL SDL文字列を生成
   */
  @measure
  static generateSDLFromMetadata(metadata: SDLTypeMetadata): string {
    const typeName = metadata.isInput ? "input" : "type";
    const sdl = [`${typeName} ${metadata.name} {`];

    for (const field of metadata.fields) {
      const fieldType = this.formatFieldType(field);
      sdl.push(`  ${field.name}: ${fieldType}`);
    }

    sdl.push("}");

    return `${sdl.join("\n")}\n`;
  }

  /**
   * 複数のSDLTypeMetadataからGraphQL SDL文字列を生成
   */
  @measure
  static generateSDL(metadataList: SDLTypeMetadata[] = []): string {
    const sdl: string[] = [];

    metadataList.forEach((metadata) => {
      sdl.push(this.generateSDLFromMetadata(metadata));
    });

    return sdl.join("\n");
  }

  /**
   * フィールドの型変換ヘルパー関数
   */
  static formatFieldType(field: SDLFieldMetadata): string {
    let fieldType = field.type;

    if (field.array) {
      const elementType = `${field.type || "JSON"}!`;
      fieldType = `[${elementType}]`;
    }

    if (field.required) {
      fieldType += "!";
    }

    return fieldType;
  }

  /**
   * SDL文字列にコメントを追加
   */
  static addComment(sdl: string, comment: string): string {
    return `# ${comment}\n${sdl}`;
  }

  /**
   * 複数のSDL文字列を結合
   */
  static combineSDL(...sdlParts: string[]): string {
    return sdlParts.filter(Boolean).join("\n\n");
  }
}
