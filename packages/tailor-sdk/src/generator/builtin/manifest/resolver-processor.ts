import fs from "node:fs";
import path from "node:path";
import { Resolver } from "@/services/pipeline/resolver";
import type { ResolverManifestMetadata, PipelineInfo } from "./types";
import { measure } from "@/performance";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";
import { getDistDir } from "@/config";
import { StepDef } from "@/services/pipeline/types";

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

    const typeBaseName =
      resolver.name.charAt(0).toUpperCase() + resolver.name.slice(1);
    return {
      name: resolver.name,
      inputType: `${typeBaseName}Input`,
      outputType: `${typeBaseName}Output`,
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
   * TailorType型からフィールド情報を抽出
   */
  private static extractTypeFields(
    type: any,
  ):
    | Record<
        string,
        { type: string; required: boolean; array: boolean; fields?: any }
      >
    | undefined {
    if (!type || !type.fields) {
      return undefined;
    }

    const fields: Record<
      string,
      { type: string; required: boolean; array: boolean; fields?: any }
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

        // nested objectの場合、fieldsプロパティも含める
        if (metadata.type === "nested" && fieldObj.fields) {
          fields[fieldName].fields = fieldObj.fields;
        }
      }
    }

    return Object.keys(fields).length > 0 ? fields : undefined;
  }
}
