import fs from "node:fs";
import path from "node:path";
import { capitalize } from "es-toolkit";
import multiline from "multiline-ts";
import { Resolver } from "../../services/pipeline/resolver";
import { SDLUtils } from "./utils";
import { measure } from "../../performance";
import { ResolverSDLMetadata } from "./types";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";
import { getDistDir } from "../../config";
import { TypeProcessor } from "./type-processor";
/**
 * Resolver処理ロジック
 * ResolverからGraphQL拡張定義の生成を担当
 */
export class ResolverProcessor {
  /**
   * ResolverからSDLメタデータを抽出（統合版）
   * 既存のResolver.toSDLMetadata()ロジックを統合
   */
  @measure
  static async processResolver(
    resolver: Resolver,
  ): Promise<ResolverSDLMetadata> {
    if (!resolver.output) {
      throw new Error(
        `Resolver "${resolver.name}" must have an output type defined. Use .returns() to specify the output type.`,
      );
    }

    // SDL生成ロジック（元のResolver.toSDLMetadata()から移行）
    const inputMetadata = await TypeProcessor.processType(resolver.input, true);
    const outputMetadata = await TypeProcessor.processType(resolver.output, false);

    const sdl = multiline/* gql */ `
    ${SDLUtils.generateSDLFromMetadata(inputMetadata)}
    ${SDLUtils.generateSDLFromMetadata(outputMetadata)}
    extend type ${capitalize(resolver.queryType)} {
      ${resolver.name}(input: ${inputMetadata.name}): ${outputMetadata.name}
    }
    `;

    // パイプライン処理ロジック（元のResolver.toSDLMetadata()から移行）
    const pipelines = resolver.steps.map(
      (step: [string, string, unknown, unknown]) => {
        const [type, name] = step;
        switch (type) {
          case "fn":
          case "sql": {
            const functionPath = path.join(
              getDistDir(),
              "functions",
              `${resolver.name}__${name}.js`,
            );
            let functionCode = "";
            try {
              functionCode = fs.readFileSync(functionPath, "utf-8");
            } catch {
              console.warn(`Function file not found: ${functionPath}`);
            }
            return {
              name,
              description: name,
              operationType: PipelineResolver_OperationType.FUNCTION,
              operationSource: functionCode,
              operationName: name,
            };
          }
          case "gql":
            return {
              name,
              description: name,
              operationType: PipelineResolver_OperationType.GRAPHQL,
              operationSource: "",
              operationName: name,
            };
          default:
            throw new Error(`Unsupported step kind: ${step[0]}`);
        }
      },
    );

    return {
      name: resolver.name,
      sdl,
      inputType: inputMetadata.name,
      outputType: outputMetadata.name,
      queryType: resolver.queryType,
      pipelines,
    };
  }

  /**
   * ResolverからSDL文字列のみを抽出
   */
  @measure
  static async processResolverToSDL(resolver: Resolver): Promise<string> {
    const metadata = await this.processResolver(resolver);
    return metadata.sdl;
  }

  /**
   * 複数のResolverを処理してSDL文字列を生成
   */
  @measure
  static async processResolvers(resolvers: Resolver[]): Promise<string> {
    const sdlParts: string[] = [];

    for (const resolver of resolvers) {
      const sdl = await this.processResolverToSDL(resolver);
      sdlParts.push(SDLUtils.addComment(sdl, `Resolver: ${resolver.name}`));
    }

    return SDLUtils.combineSDL(...sdlParts);
  }

  /**
   * Resolverの名前とSDLのマップを作成
   */
  @measure
  static async processResolversToMap(
    resolvers: Record<string, Resolver>,
  ): Promise<Record<string, ResolverSDLMetadata>> {
    const result: Record<string, ResolverSDLMetadata> = {};

    for (const [name, resolver] of Object.entries(resolvers)) {
      result[name] = await this.processResolver(resolver);
    }

    return result;
  }

  /**
   * Resolverの配列から名前をキーとするマップを作成
   */
  @measure
  static async processResolverArrayToMap(
    resolvers: Resolver[],
  ): Promise<Record<string, ResolverSDLMetadata>> {
    const result: Record<string, ResolverSDLMetadata> = {};

    for (const resolver of resolvers) {
      const metadata = await this.processResolver(resolver);
      result[resolver.name] = metadata;
    }

    return result;
  }

  /**
   * Input/Output型の処理
   * ResolverのInput/Output型からSDL定義を生成
   */
  @measure
  static async processInputOutputTypes(resolver: Resolver): Promise<string> {
    if (!resolver.output) {
      throw new Error(
        `Resolver "${resolver.name}" must have an output type defined. Use .returns() to specify the output type.`,
      );
    }

    const inputMetadata = await TypeProcessor.processType(resolver.input, true);
    const outputMetadata = await TypeProcessor.processType(resolver.output, false);

    const inputSDL = SDLUtils.generateSDLFromMetadata(inputMetadata);
    const outputSDL = SDLUtils.generateSDLFromMetadata(outputMetadata);

    return SDLUtils.combineSDL(inputSDL, outputSDL);
  }

  /**
   * Resolverの依存関係を解析（将来の拡張用）
   */
  static analyzeDependencies(metadata: ResolverSDLMetadata): string[] {
    const dependencies: string[] = [];

    // Input/Output型を依存関係として追加
    if (metadata.inputType) {
      dependencies.push(metadata.inputType);
    }
    if (metadata.outputType) {
      dependencies.push(metadata.outputType);
    }

    return [...new Set(dependencies)]; // 重複を除去
  }

  /**
   * Query/Mutation別にResolverを分類
   */
  static categorizeResolvers(resolvers: Resolver[]): {
    queries: Resolver[];
    mutations: Resolver[];
  } {
    const queries: Resolver[] = [];
    const mutations: Resolver[] = [];

    for (const resolver of resolvers) {
      if (resolver.queryType === "query") {
        queries.push(resolver);
      } else if (resolver.queryType === "mutation") {
        mutations.push(resolver);
      }
    }

    return { queries, mutations };
  }
}
