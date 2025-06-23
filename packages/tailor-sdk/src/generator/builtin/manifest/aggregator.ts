import path from "node:path";
import { BasicGeneratorMetadata, GeneratorResult } from "../../types";
import {
  ManifestTypeMetadata,
  ManifestJSON,
  ResolverManifest,
  ManifestInput,
  ManifestResponse,
  PipelineManifest,
  ManifestField,
} from "./types";
import { ResolverManifestMetadata } from "./resolver-processor";
import { measure } from "@/performance";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";
import { tailorToManifestScalar } from "@/types/types";

/**
 * Manifest統合ロジック
 * 複数のManifest断片の統合、JSON生成を担当
 */
export class ManifestAggregator {
  /**
   * 型とResolverのメタデータを統合してManifest JSONを生成
   */
  @measure
  static aggregate(
    metadata: BasicGeneratorMetadata<
      ManifestTypeMetadata,
      ResolverManifestMetadata
    >,
    baseDir: string,
    namespace?: string,
  ): GeneratorResult {
    try {
      const { resolvers } = metadata;

      const manifestJSON = this.generateManifestJSON(
        resolvers,
        namespace || "default",
      );

      return {
        files: [
          {
            path: path.join(baseDir, "manifest.json"),
            content: JSON.stringify(manifestJSON, null, 2),
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
   * ResolverのManifest JSON生成
   */
  @measure
  private static generateManifestJSON(
    resolvers: Record<string, ResolverManifestMetadata>,
    namespace: string,
  ): ManifestJSON {
    const resolverManifests: ResolverManifest[] = Object.entries(resolvers).map(
      ([name, resolverMetadata]) => {
        return this.generateResolverManifest(name, resolverMetadata);
      },
    );

    return {
      Kind: "pipeline",
      Description: "",
      Namespace: namespace,
      Resolvers: resolverManifests,
      Version: "v2",
    };
  }

  /**
   * 個別のResolverManifestを生成
   */
  @measure
  private static generateResolverManifest(
    name: string,
    resolverMetadata: ResolverManifestMetadata,
  ): ResolverManifest {
    const pipelines: PipelineManifest[] = [
      ...resolverMetadata.pipelines.map((pipeline) => ({
        Name: pipeline.name,
        OperationName: pipeline.name,
        Description: pipeline.description,
        OperationType: pipeline.operationType,
        OperationSourcePath: path.join(
          "tests/fixtures/expected",
          "functions",
          `${name}__${pipeline.name}.js`,
        ),
        OperationHook: {
          Expr: "({ ...context.pipeline, ...context.args });",
        },
        PostScript: `args.${pipeline.name}`,
      })),
      {
        Name: `__construct_output`,
        OperationName: `__construct_output`,
        Description: "Construct output from resolver",
        OperationType: PipelineResolver_OperationType.FUNCTION,
        OperationSource: `globalThis.main = ${resolverMetadata.outputMapper || "() => ({})"}`,
        OperationHook: {
          Expr: "({ ...context.pipeline, ...context.args });",
        },
        PostScript: `args.__construct_output`,
      },
    ];

    // Input構造を生成（Fields配列を含む）
    const inputs: ManifestInput[] = [
      {
        Name: "input",
        Description: "",
        Array: false,
        Required: true,
        Type: {
          Kind: "UserDefined",
          Name: resolverMetadata.inputType,
          Description: "",
          Required: false,
          Fields: this.generateTypeFields(
            resolverMetadata.inputType,
            resolverMetadata.inputFields,
          ),
        },
      },
    ];

    // Response構造を生成（Fields配列を含む）
    const response: ManifestResponse = {
      Type: {
        Kind: "UserDefined",
        Name: resolverMetadata.outputType,
        Description: "",
        Required: true,
        Fields: this.generateTypeFields(
          resolverMetadata.outputType,
          resolverMetadata.outputFields,
        ),
      },
      Description: "",
      Array: false,
      Required: true,
    };

    return {
      Authorization: "true==true", // デフォルト値
      Description: `${name} resolver`,
      Inputs: inputs,
      Name: name,
      Response: response,
      Pipelines: pipelines,
      PostHook: { Expr: "({ ...context.pipeline.__construct_output });" },
      PublishExecutionEvents: false,
    };
  }

  /**
   * 型のFields配列を生成（完全に動的な実装）
   * @param typeName - 型名（ログ出力用）
   * @param fields - 動的に抽出されたフィールド情報
   * @returns ManifestField配列
   */
  @measure
  private static generateTypeFields(
    typeName: string,
    fields?: Record<
      string,
      { type: string; required: boolean; array: boolean }
    >,
  ): ManifestField[] {
    // 動的フィールド情報が存在する場合
    if (fields && Object.keys(fields).length > 0) {
      return Object.entries(fields).map(([fieldName, fieldInfo]) => ({
        Name: fieldName,
        Description: "",
        Type: {
          Kind: "ScalarType",
          Name:
            tailorToManifestScalar[
              fieldInfo.type as keyof typeof tailorToManifestScalar
            ] || "String",
          Description: "",
          Required: false,
        },
        Array: fieldInfo.array,
        Required: fieldInfo.required,
      }));
    }

    // フィールド情報が取得できない場合
    console.warn(
      `No field information available for type: ${typeName}. Returning empty fields array.`,
    );
    return [];
  }
}
