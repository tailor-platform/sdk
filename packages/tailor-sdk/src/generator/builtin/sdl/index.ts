import { CodeGenerator, GeneratorResult, GeneratorInput } from "../../types";
import { TailorDBType } from "@/services/tailordb/schema";
import { Resolver } from "@/services/pipeline/resolver";
import { Executor } from "@/services/executor/types";
import { SDLTypeMetadata, ResolverSDLMetadata } from "./types";
import { TypeProcessor } from "./type-processor";
import { ResolverProcessor } from "./resolver-processor";
import { SDLAggregator } from "./aggregator";

export const SdlGeneratorID = "@tailor/sdl";

/**
 * SDL生成システムのメインエントリーポイント
 */
export class SdlGenerator
  implements
    CodeGenerator<
      SDLTypeMetadata,
      ResolverSDLMetadata,
      undefined,
      Record<string, SDLTypeMetadata>,
      Record<string, ResolverSDLMetadata>
    >
{
  readonly id = SdlGeneratorID;
  readonly description = "Generates SDL files for TailorDB types and resolvers";

  /**
   * TailorDBTypeを処理してSDLTypeMetadataを生成
   */
  async processType(type: TailorDBType): Promise<SDLTypeMetadata> {
    return await TypeProcessor.processDBType(type);
  }

  /**
   * Resolverを処理してResolverSDLMetadataを生成
   */
  async processResolver(resolver: Resolver): Promise<ResolverSDLMetadata> {
    return await ResolverProcessor.processResolver(resolver);
  }

  /**
   * Executorを処理 - SDLジェネレーターではExecutorを処理しない
   */
  async processExecutor(_executor: Executor): Promise<undefined> {
    return undefined;
  }

  /**
   * 処理されたメタデータを統合してSDLファイルを生成
   */
  aggregate(
    inputs: GeneratorInput<
      Record<string, SDLTypeMetadata>,
      Record<string, ResolverSDLMetadata>
    >[],
    _: undefined[],
    baseDir: string,
  ): GeneratorResult {
    // すべてのnamespaceのメタデータを統合
    const allTypes: Record<string, SDLTypeMetadata> = {};
    const allResolvers: Record<string, ResolverSDLMetadata> = {};

    for (const input of inputs) {
      // TailorDB types
      for (const nsResult of input.tailordb) {
        Object.assign(allTypes, nsResult.types);
      }
      // Pipeline resolvers
      for (const nsResult of input.pipeline) {
        Object.assign(allResolvers, nsResult.resolvers);
      }
    }

    return SDLAggregator.aggregate(
      {
        types: allTypes,
        resolvers: allResolvers,
        executors: [],
      },
      baseDir,
    );
  }
}
