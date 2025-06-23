import fs from "node:fs";
import path from "node:path";
import { Resolver } from "../../services/pipeline/resolver";
import type { ResolverManifestMetadata, PipelineInfo } from "./types";
import { measure } from "../../performance";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";
import { getDistDir } from "../../config";
import { StepDef } from "../../services/pipeline/types";

export { ResolverManifestMetadata };

/**
 * Resolver処理ロジック（Manifest生成専用）
 * SDL生成とは独立してManifest用のメタデータを生成
 */
export class ResolverProcessor {
  /**
   * ResolverからManifest用メタデータを抽出
   */
  @measure
  static async processResolver(
    resolver: Resolver,
  ): Promise<ResolverManifestMetadata> {
    const pipelines: PipelineInfo[] = resolver.steps.map(
      (step: StepDef<string, any, any, any>) => {
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
            };
          }
          case "gql":
            return {
              name,
              description: name,
              operationType: PipelineResolver_OperationType.GRAPHQL,
              operationSource: "",
            };
          default:
            throw new Error(`Unsupported step kind: ${step[0]}`);
        }
      },
    );

    // Input型のフィールド情報を抽出
    const inputFields = this.extractTypeFields(resolver.input);

    // Output型のフィールド情報を抽出
    const outputFields = resolver.output
      ? this.extractTypeFields(resolver.output)
      : undefined;

    return {
      name: resolver.name,
      inputType: resolver.input.name,
      outputType: resolver.output?.name || "JSON",
      queryType: resolver.queryType,
      pipelines,
      outputMapper: resolver.outputMapper?.toString(),
      inputFields,
      outputFields,
    };
  }

  /**
   * 複数のResolverを処理
   */
  @measure
  static async processResolvers(
    resolvers: Resolver[],
  ): Promise<Record<string, ResolverManifestMetadata>> {
    const result: Record<string, ResolverManifestMetadata> = {};

    for (const resolver of resolvers) {
      const metadata = await this.processResolver(resolver);
      result[resolver.name] = metadata;
    }

    return result;
  }

  /**
   * Resolverの配列から名前をキーとするマップを作成
   */
  @measure
  static async processResolverArrayToMap(
    resolvers: Resolver[],
  ): Promise<Record<string, ResolverManifestMetadata>> {
    const result: Record<string, ResolverManifestMetadata> = {};

    for (const resolver of resolvers) {
      const metadata = await this.processResolver(resolver);
      result[resolver.name] = metadata;
    }

    return result;
  }

  /**
   * Resolverの依存関係を解析（将来の拡張用）
   */
  static analyzeDependencies(metadata: ResolverManifestMetadata): string[] {
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

  /**
   * TailorType型からフィールド情報を抽出
   */
  private static extractTypeFields(
    type: any,
  ):
    | Record<string, { type: string; required: boolean; array: boolean }>
    | undefined {
    if (!type || !type.fields) {
      return undefined;
    }

    const fields: Record<
      string,
      { type: string; required: boolean; array: boolean }
    > = {};

    for (const [fieldName, field] of Object.entries(type.fields)) {
      const fieldObj = field as any;
      if (fieldObj && fieldObj.metadata) {
        const metadata = fieldObj.metadata;
        fields[fieldName] = {
          type: metadata.type || "string",
          required: metadata.required !== false,
          array: metadata.array === true,
        };
      }
    }

    return Object.keys(fields).length > 0 ? fields : undefined;
  }
}
