import { capitalize } from "es-toolkit";
import multiline from "multiline-ts";
import { Resolver } from "@/services/pipeline/resolver";
import { SDLUtils } from "./utils";
import { measure } from "@/performance";
import { ResolverSDLMetadata } from "./types";
import { OperationType } from "@/types/operator";
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

    const resolverBaseName =
      resolver.name.charAt(0).toUpperCase() + resolver.name.slice(1);
    const inputMetadata = await TypeProcessor.processType(
      resolver.input,
      true,
      `${resolverBaseName}Input`,
    );
    const outputMetadata = await TypeProcessor.processType(
      resolver.output,
      false,
      `${resolverBaseName}Output`,
    );

    const sdl = multiline/* gql */ `
    ${SDLUtils.generateSDLFromMetadata(inputMetadata)}
    ${SDLUtils.generateSDLFromMetadata(outputMetadata)}
    extend type ${capitalize(resolver.queryType)} {
      ${resolver.name}(input: ${inputMetadata.name}): ${outputMetadata.name}
    }
    `;

    const pipelines = resolver.steps.map(
      (step: [string, string, unknown, unknown]) => {
        const [type, name] = step;
        switch (type) {
          case "fn":
          case "sql": {
            return {
              name,
              description: name,
              operationType: OperationType.FUNCTION,
              operationSource: "",
              operationName: name,
            };
          }
          case "gql":
            return {
              name,
              description: name,
              operationType: OperationType.GRAPHQL,
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

  @measure
  static async processResolverToSDL(resolver: Resolver): Promise<string> {
    const metadata = await this.processResolver(resolver);
    return metadata.sdl;
  }

  @measure
  static async processResolvers(resolvers: Resolver[]): Promise<string> {
    const sdlParts: string[] = [];

    for (const resolver of resolvers) {
      const sdl = await this.processResolverToSDL(resolver);
      sdlParts.push(SDLUtils.addComment(sdl, `Resolver: ${resolver.name}`));
    }

    return SDLUtils.combineSDL(...sdlParts);
  }
}
