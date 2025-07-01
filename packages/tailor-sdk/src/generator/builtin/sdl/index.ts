import {
  CodeGenerator,
  BasicGeneratorMetadata,
  GeneratorResult,
} from "../../types";
import { TailorDBType } from "@/services/tailordb/schema";
import { Resolver } from "@/services/pipeline/resolver";
import { SDLTypeMetadata, ResolverSDLMetadata } from "./types";
import { TypeProcessor } from "./type-processor";
import { ResolverProcessor } from "./resolver-processor";
import { SDLAggregator } from "./aggregator";
import { measure } from "@/performance";

export const SdlGeneratorID = "@tailor/sdl";

/**
 * SDL生成システムのメインエントリーポイント
 */
export class SdlGenerator
  implements CodeGenerator<SDLTypeMetadata, ResolverSDLMetadata>
{
  readonly id = SdlGeneratorID;
  readonly description = "Generates SDL files for TailorDB types and resolvers";

  /**
   * TailorDBTypeを処理してSDLTypeMetadataを生成
   */
  @measure
  async processType(type: TailorDBType): Promise<SDLTypeMetadata> {
    return await TypeProcessor.processDBType(type);
  }

  /**
   * Resolverを処理してResolverSDLMetadataを生成
   */
  @measure
  async processResolver(resolver: Resolver): Promise<ResolverSDLMetadata> {
    return await ResolverProcessor.processResolver(resolver);
  }

  /**
   * 処理されたメタデータを統合してSDLファイルを生成
   */
  @measure
  aggregate(
    metadata: BasicGeneratorMetadata<SDLTypeMetadata, ResolverSDLMetadata>,
    baseDir: string,
  ): GeneratorResult {
    return SDLAggregator.aggregate(metadata, baseDir);
  }
}
