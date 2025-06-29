import {
  CodeGenerator,
  BasicGeneratorMetadata,
  GeneratorResult,
} from "../../types";
import { TailorDBType } from "@/services/tailordb/schema";
import { Resolver } from "@/services/pipeline/resolver";
import { measure } from "@/performance";
import { ManifestTypeMetadata, ResolverManifestMetadata } from "./types";
import { TypeProcessor } from "./type-processor";
import { ResolverProcessor } from "./resolver-processor";
import { ManifestAggregator } from "./aggregator";
import type { Workspace } from "@/workspace";
import type { ApplyOptions } from "@/cli/args";

/**
 * Manifest生成システムのメインエントリーポイント
 */
export class ManifestGenerator
  implements CodeGenerator<ManifestTypeMetadata, ResolverManifestMetadata>
{
  readonly id = "@tailor/manifest";
  readonly description =
    "Generates Manifest JSON files for TailorDB types and resolvers";
  public workspace!: Workspace;

  constructor(public readonly option: ApplyOptions) {}

  /**
   * TailorDBTypeを処理してManifestTypeMetadataを生成
   */
  @measure
  async processType(type: TailorDBType): Promise<ManifestTypeMetadata> {
    return await TypeProcessor.processType(type);
  }

  /**
   * Resolverを処理してResolverManifestMetadataを生成
   */
  @measure
  async processResolver(resolver: Resolver): Promise<ResolverManifestMetadata> {
    return await ResolverProcessor.processResolver(resolver);
  }

  /**
   * 処理されたメタデータを統合してManifest JSONを生成
   */
  @measure
  async aggregate(
    metadata: BasicGeneratorMetadata<
      ManifestTypeMetadata,
      ResolverManifestMetadata
    >,
  ): Promise<GeneratorResult> {
    return await ManifestAggregator.aggregate(
      metadata,
      undefined,
      this.workspace,
    );
  }
}
