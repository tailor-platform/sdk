/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "node:path";
import fs from "node:fs";
import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";
import { ResolverBundler } from "./bundler";
import { PipelineResolverServiceConfig } from "./types";
import { measure } from "../../performance";
import { Resolver } from "./resolver";
import { isResolver } from "./utils";

export class PipelineResolverService {
  private bundler: ResolverBundler;
  private resolvers: Resolver<any, any, any, any, any, any>[] = [];

  constructor(
    public readonly namespace: string,
    private readonly config: PipelineResolverServiceConfig,
  ) {
    this.bundler = new ResolverBundler(namespace, config);
  }

  @measure
  async build() {
    await this.loadResolvers();
    await this.bundler.bundle();
  }

  toManifestJSON() {
    const resolvers = this.resolvers.map(
      (resolver: Resolver<any, any, any, any, any, any>) => {
        const metadata = resolver.toSDLMetadata();

        const manifest: any = {
          Authorization: "true==true", // デフォルト値
          Description: `${resolver.name} resolver`,
          Inputs: [],
          Name: resolver.name,
          Response: {},
          Pipelines: [
            ...metadata.pipelines.map((pipeline: any) => ({
              Name: pipeline.name,
              OperationName: pipeline.name,
              Description: pipeline.description,
              OperationType: pipeline.operationType,
              OperationSourcePath: path.join(
                ".tailor-sdk",
                "functions",
                `${resolver.name}__${pipeline.name}.js`,
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
              OperationSource: `globalThis.main = ${resolver.outputMapper.toString()}`,
              OperationHook: {
                Expr: "({ ...context.pipeline, ...context.args });",
              },
              PostScript: `args.__construct_output`,
            },
          ],
          PostHook: { Expr: "({ ...context.pipeline.__construct_output });" },
          PublishExecutionEvents: false,
        };

        // Input構造を生成
        const input = resolver.input.toSDLMetadata(true);
        manifest.Inputs.push({
          Name: "input",
          Description: "",
          Array: false,
          Required: true,
          Type: {
            Kind: "UserDefined",
            Name: input.name,
            Description: "",
            Required: false,
            Fields: input.fields.map((field: any) => ({
              Name: field.name,
              Description: "",
              Type: {
                Kind: "ScalarType",
                Name: field.type,
                Description: "",
                Required: false,
              },
              Array: field.array || false,
              Required: field.required || false,
            })),
          },
        });

        const output = resolver.output.toSDLMetadata();
        manifest.Response = {
          Type: {
            Kind: "UserDefined",
            Name: output.name,
            Description: "", // TODO: 出力の説明を確認
            Required: true, // TODO: 出力の必須性を確認
          },
          Description: "", // TODO: 出力の説明を確認
          Array: false,
          Required: true, // TODO: 出力の必須性を確認
        };

        manifest.Response.Type.Fields = output.fields.map((field: any) => ({
          Name: field.name,
          Description: "",
          Type: {
            Kind: "ScalarType",
            Name: field.type,
            Description: "",
            Required: false,
          },
          Array: field.array || false,
          Required: field.required || false,
        }));

        return manifest;
      },
    );

    return {
      Kind: "pipeline",
      Description: "",
      Namespace: this.namespace,
      Resolvers: resolvers,
      Version: "v2",
    };
  }

  @measure
  private async loadResolvers(): Promise<void> {
    if (!this.config.files || this.config.files.length === 0) {
      return;
    }

    const resolverFiles: string[] = [];
    for (const pattern of this.config.files) {
      const absolutePattern = path.resolve(process.cwd(), pattern);
      try {
        const matchedFiles = fs.globSync(absolutePattern);
        resolverFiles.push(...matchedFiles);
      } catch (error) {
        console.warn(`Failed to glob pattern "${pattern}":`, error);
      }
    }

    for (const resolverFile of resolverFiles) {
      try {
        const resolverModule = await import(resolverFile);
        const resolver = resolverModule.default;
        if (isResolver(resolver)) {
          this.resolvers.push(resolver);
        }
      } catch (error) {
        console.error(`Failed to load resolver from ${resolverFile}:`, error);
      }
    }
  }

  getResolverSDLMetadata() {
    const metadataList: Array<{
      name: string;
      sdl: string;
      pipelines: Array<{
        name: string;
        description: string;
        operationType: any;
        operationSource: string;
        operationName: string;
      }>;
    }> = [];

    for (const resolver of this.resolvers) {
      const metadata = resolver.toSDLMetadata();
      metadataList.push(metadata);
    }

    return metadataList;
  }
}
