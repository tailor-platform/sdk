import fs from "node:fs";
import path from "node:path";
import { Resolver } from "@/services/pipeline/resolver";
import type { ResolverManifestMetadata, PipelineInfo } from "./types";
import { OperationType } from "@/types/operator";
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
              operationType: OperationType.FUNCTION,
              operationSource: functionCode,
            };
          }
          case "gql":
            return {
              name,
              description: name,
              operationType: OperationType.GRAPHQL,
              operationSource: "",
            };
          default:
            throw new Error(`Unsupported step kind: ${step[0]}`);
        }
      },
    );

    // Input型のフィールド情報を抽出
    const inputFields = ResolverProcessor.extractTypeFields(resolver.input);

    // Output型のフィールド情報を抽出
    const outputFields = resolver.output
      ? ResolverProcessor.extractTypeFields(resolver.output)
      : undefined;

    const typeBaseName =
      resolver.name.charAt(0).toUpperCase() + resolver.name.slice(1);

    const metadata: ResolverManifestMetadata = {
      name: resolver.name,
      inputType: `${typeBaseName}Input`,
      outputType: `${typeBaseName}Output`,
      queryType: resolver.queryType,
      pipelines,
      outputMapper: resolver.outputMapper?.toString(),
      inputFields,
      outputFields,
    };

    // 最適化：単一のResolverに対するマニフェスト生成処理をここで実行
    const resolverManifest = ResolverProcessor.generateResolverManifest(
      resolver.name,
      metadata,
      getDistDir(),
    );

    return {
      ...metadata,
      resolverManifest, // 生成されたResolverManifestを含める
    };
  }

  /**
   * 単一のResolverに対するマニフェスト生成処理
   * 元のManifestAggregator.generateResolverManifest相当の処理
   */
  static generateResolverManifest(
    name: string,
    resolverMetadata: ResolverManifestMetadata,
    baseDir?: string,
  ): any {
    const pipelines: any[] = [
      ...resolverMetadata.pipelines.map((pipeline) => {
        const sourcePath = path.join(
          baseDir || getDistDir(),
          "functions",
          `${name}__${pipeline.name}.js`,
        );

        return {
          Name: pipeline.name,
          OperationName: pipeline.name,
          Description: pipeline.description,
          OperationType: pipeline.operationType,
          OperationSourcePath: sourcePath,
          OperationHook: {
            Expr: "({ ...context.pipeline, ...context.args });",
          },
          PostScript: `args.${pipeline.name}`,
        };
      }),
      {
        Name: `__construct_output`,
        OperationName: `__construct_output`,
        Description: "Construct output from resolver",
        OperationType: OperationType.FUNCTION,
        OperationSource: `globalThis.main = ${resolverMetadata.outputMapper || "() => ({})"}`,
        OperationHook: {
          Expr: "({ ...context.pipeline, ...context.args });",
        },
        PostScript: `args.__construct_output`,
      },
    ];

    // Input構造を生成（Fields配列を含む）
    const inputs: any[] = [
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
          Fields: ResolverProcessor.generateTypeFields(
            resolverMetadata.inputType,
            resolverMetadata.inputFields,
          ),
        },
      },
    ];

    // Response構造を生成（Fields配列を含む）
    const response: any = {
      Type: {
        Kind: "UserDefined",
        Name: resolverMetadata.outputType,
        Description: "",
        Required: true,
        Fields: ResolverProcessor.generateTypeFields(
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
   * 型のFields配列を生成
   */
  private static getTypeDefinition(fieldType: string): {
    kind: "ScalarType" | "CustomScalarType";
    name: string;
  } {
    const tailorToGraphQL: Record<string, string> = {
      string: "String",
      number: "Int",
      integer: "Int",
      boolean: "Boolean",
      float: "Float",
      date: "String",
      datetime: "String",
      time: "String",
      json: "String",
    };

    const customScalarTypes = ["date", "datetime", "time"];
    const isCustomScalar = customScalarTypes.includes(fieldType);

    return {
      kind: isCustomScalar ? "CustomScalarType" : "ScalarType",
      name: isCustomScalar
        ? fieldType === "datetime"
          ? "DateTime"
          : fieldType === "date"
            ? "Date"
            : fieldType === "time"
              ? "Time"
              : fieldType
        : tailorToGraphQL[fieldType as keyof typeof tailorToGraphQL] ||
          "String",
    };
  }

  private static createFieldDefinition(
    fieldName: string,
    fieldType: string,
    required: boolean,
    array: boolean,
    description: string = "",
  ): any {
    const typeDefinition = ResolverProcessor.getTypeDefinition(fieldType);

    return {
      Name: fieldName,
      Description: description,
      Type: {
        Kind: typeDefinition.kind,
        Name: typeDefinition.name,
        Description: "",
        Required: false, // Note: This is always false in the CUE schema for scalar types
      },
      Array: array,
      Required: required,
    };
  }

  static generateTypeFields(
    typeName: string,
    fields?: Record<
      string,
      { type: string; required: boolean; array: boolean; fields?: any }
    >,
    allFields?: Record<string, any>,
  ): any[] {
    if (fields && Object.keys(fields).length > 0) {
      return Object.entries(fields).map(([fieldName, fieldInfo]) => {
        if (fieldInfo.type === "nested") {
          const nestedTypeName =
            fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
          const capitalizedTypeName =
            typeName +
            nestedTypeName.charAt(0).toUpperCase() +
            nestedTypeName.slice(1);

          let nestedFields: any[] = [];
          if (fieldInfo.fields && typeof fieldInfo.fields === "object") {
            nestedFields = ResolverProcessor.generateNestedFields(
              fieldInfo.fields,
              capitalizedTypeName,
            );
          } else if (allFields && allFields[capitalizedTypeName]) {
            nestedFields = ResolverProcessor.generateTypeFields(
              capitalizedTypeName,
              allFields[capitalizedTypeName],
              allFields,
            );
          } else {
            console.warn(
              `No nested field information found for ${fieldName} in type ${typeName}. Using empty fields.`,
            );
          }

          return {
            Name: fieldName,
            Description: "",
            Type: {
              Kind: "UserDefined",
              Name: capitalizedTypeName,
              Description: "",
              Required: fieldInfo.required,
              Fields: nestedFields,
            },
            Array: fieldInfo.array,
            Required: fieldInfo.required,
          };
        }

        return ResolverProcessor.createFieldDefinition(
          fieldName,
          fieldInfo.type,
          fieldInfo.required,
          fieldInfo.array,
        );
      });
    }

    console.warn(
      `No field information available for type: ${typeName}. Returning empty fields array.`,
    );
    return [];
  }

  /**
   * Nested objectのフィールドを再帰的に処理
   */
  static generateNestedFields(
    nestedFields: any,
    parentTypeName?: string,
  ): any[] {
    if (!nestedFields || typeof nestedFields !== "object") {
      return [];
    }

    return Object.entries(nestedFields).map(
      ([fieldName, field]: [string, any]) => {
        const fieldObj = field as any;

        const metadata = fieldObj?.metadata || {};
        const fieldType = metadata.type || "string";
        const required = metadata.required !== false;
        const array = metadata.array === true;

        if (fieldType === "nested" && fieldObj.fields) {
          const nestedTypeName = parentTypeName
            ? parentTypeName +
              fieldName.charAt(0).toUpperCase() +
              fieldName.slice(1)
            : fieldName.charAt(0).toUpperCase() + fieldName.slice(1);

          return {
            Name: fieldName,
            Description: metadata.description || "",
            Type: {
              Kind: "UserDefined",
              Name: nestedTypeName,
              Description: "",
              Required: required,
              Fields: ResolverProcessor.generateNestedFields(
                fieldObj.fields,
                nestedTypeName,
              ),
            },
            Array: array,
            Required: required,
          };
        }

        return ResolverProcessor.createFieldDefinition(
          fieldName,
          fieldType,
          required,
          array,
          metadata.description || "",
        );
      },
    );
  }

  /**
   * 複数のResolverを処理
   */
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
