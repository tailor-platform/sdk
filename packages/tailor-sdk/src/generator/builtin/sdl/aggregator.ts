import path from "node:path";
import { BasicGeneratorMetadata, GeneratorResult } from "../../types";
import { SDLTypeMetadata } from "./types";
import { ResolverSDLMetadata } from "./types";
import { SDLUtils } from "./utils";

/**
 * SDL統合ロジック
 * 複数のSDL断片の統合、コメント付与、フォーマットを担当
 * workspace.tsの統合ロジックを移植
 */
export class SDLAggregator {
  /**
   * 型とResolverのメタデータを統合してSDLファイルを生成
   */
  static aggregate(
    metadata: BasicGeneratorMetadata<SDLTypeMetadata, ResolverSDLMetadata>,
    baseDir: string,
  ): GeneratorResult {
    try {
      const { types, resolvers } = metadata;

      const tailordbSDL = this.generateTailordbSDL(types);
      const resolverSDL = this.generateResolverSDL(resolvers);
      const combinedSDL = SDLUtils.combineSDL(tailordbSDL, resolverSDL);
      return {
        files: [
          {
            path: path.join(baseDir, "schema.graphql"),
            content: combinedSDL + "\n\n", // ファイル末尾に改行を2つ追加（期待値に合わせる）
          },
        ],
      };
    } catch (error) {
      return {
        files: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * TailorDB型のSDL生成
   */
  private static generateTailordbSDL(
    types: Record<string, SDLTypeMetadata>,
  ): string {
    return SDLUtils.combineSDL(
      ...Object.entries(types).map(([name, typeMetadata]) => {
        const sdl = SDLUtils.generateSDLFromMetadata(typeMetadata);
        return SDLUtils.addComment(sdl, `Type: ${name}`);
      }),
    );
  }

  /**
   * ResolverのSDL生成
   */
  private static generateResolverSDL(
    resolvers: Record<string, ResolverSDLMetadata>,
  ): string {
    return SDLUtils.combineSDL(
      ...Object.entries(resolvers).map(([name, resolverMetadata]) =>
        SDLUtils.addComment(resolverMetadata.sdl, `Resolver: ${name}`),
      ),
    );
  }
}
