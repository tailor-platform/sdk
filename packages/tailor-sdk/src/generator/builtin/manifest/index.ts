import { CodeGenerator, GeneratorResult, GeneratorInput } from "../../types";
import { TailorDBType } from "@/services/tailordb/schema";
import { Resolver } from "@/services/pipeline/resolver";
import { Executor } from "@/services/executor/types";
import { ManifestTypeMetadata, ResolverManifestMetadata } from "./types";
import { ExecutorManifestMetadata } from "./executor-processor";
import { TypeProcessor } from "./type-processor";
import { ResolverProcessor } from "./resolver-processor";
import { ExecutorProcessor } from "./executor-processor";
import { ManifestAggregator } from "./aggregator";
import type { Workspace } from "@/workspace";
import type { ApplyOptions } from "@/generator/options";

/**
 * Manifest生成システムのメインエントリーポイント
 */
export class ManifestGenerator
  implements
    CodeGenerator<
      ManifestTypeMetadata,
      ResolverManifestMetadata,
      ExecutorManifestMetadata,
      Record<string, ManifestTypeMetadata>,
      Record<string, ResolverManifestMetadata>
    >
{
  readonly id = "@tailor/manifest";
  readonly description =
    "Generates Manifest JSON files for TailorDB types and resolvers";
  public workspace!: Workspace;

  constructor(public readonly option: ApplyOptions) {}

  /**
   * TailorDBTypeを処理してManifestTypeMetadataを生成
   */
  async processType(type: TailorDBType): Promise<ManifestTypeMetadata> {
    return await TypeProcessor.processType(type);
  }

  /**
   * Resolverを処理してResolverManifestMetadataを生成
   */
  async processResolver(resolver: Resolver): Promise<ResolverManifestMetadata> {
    return await ResolverProcessor.processResolver(resolver);
  }

  /**
   * Executorを処理してExecutorManifestMetadataを生成
   */
  async processExecutor(executor: Executor): Promise<ExecutorManifestMetadata> {
    return await ExecutorProcessor.processExecutor(executor);
  }

  /**
   * 処理されたメタデータを統合してManifest JSONを生成
   */
  async aggregate(
    inputs: GeneratorInput<
      Record<string, ManifestTypeMetadata>,
      Record<string, ResolverManifestMetadata>
    >[],
    executorResults: ExecutorManifestMetadata[],
    _baseDir: string,
  ): Promise<GeneratorResult> {
    // 現時点では最初のapplicationのみを処理（将来的には複数application対応可能）
    if (inputs.length === 0) {
      return { files: [], errors: [] };
    }

    // すべてのnamespaceのメタデータを統合
    const allTypes: Record<string, ManifestTypeMetadata> = {};
    const allResolvers: Record<string, ResolverManifestMetadata> = {};
    const allExecutors: ExecutorManifestMetadata[] = [];
    let pipelineNamespace: string | undefined;

    for (const input of inputs) {
      // TailorDB types
      for (const nsResult of input.tailordb) {
        Object.assign(allTypes, nsResult.types);
      }
      // Pipeline resolvers
      for (const nsResult of input.pipeline) {
        Object.assign(allResolvers, nsResult.resolvers);
        // 最初のpipeline namespaceを記録
        if (!pipelineNamespace && nsResult.namespace) {
          pipelineNamespace = nsResult.namespace;
        }
      }
      // Executors
      allExecutors.push(...executorResults);
    }

    return await ManifestAggregator.aggregate(
      {
        types: allTypes,
        resolvers: allResolvers,
        executors: allExecutors,
      },
      this.workspace,
    );
  }
}
