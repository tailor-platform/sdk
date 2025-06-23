/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import path from "node:path";
import { GenerateOptions } from "@/cli/args";
import { getDistDir, WorkspaceConfig } from "@/config";
import { defineWorkspace } from "@/workspace";
import { Resolver } from "@/services/pipeline/resolver";
import { TailorDBType } from "@/services/tailordb/schema";
import { measure } from "@/performance";
import { CodeGenerator } from "./types";
import { SdlGenerator, SdlGeneratorID } from "./builtin/sdl";
import { KyselyGenerator } from "./builtin/kysely-type";

type Workspace = ReturnType<typeof defineWorkspace>;

class GenerationManager {
  private workspace: Workspace;
  private generators: CodeGenerator<any, any, any, any>[] = [];

  constructor(private readonly config: WorkspaceConfig) {
    this.workspace = defineWorkspace(config);
  }

  @measure
  async generate(_options: GenerateOptions) {
    console.log("Applying workspace:", this.workspace.config.name);
    console.log(
      "Applications:",
      this.workspace.applications.map((app) => app.name),
    );

    const baseDir = path.join(getDistDir(), "generated");
    fs.mkdirSync(baseDir, { recursive: true });

    const tailordbTypes: TailorDBType[] = [];
    const resolvers: Resolver[] = [];

    for (const app of this.workspace.applications) {
      for (const db of app.tailorDBServices) {
        console.log("TailorDB Service:", db.namespace);
        await db.apply();
        tailordbTypes.push(...db.getTypes());
      }

      console.log(
        "Pipeline Services:",
        app.pipelineResolverServices.map((service) => service.namespace),
      );
      for (const pipelineService of app.pipelineResolverServices) {
        await pipelineService.build(); // Resolverを読み込むためにbuild()を呼び出す
        resolvers.push(...pipelineService.getResolvers());
      }
    }

    this.initGenerators();
    this.processGenerators(baseDir, tailordbTypes, resolvers);
  }

  @measure
  private initGenerators() {
    if (this.generators.length > 0) {
      return;
    }

    this.generators =
      this.config.generators?.map((gen) => {
        if (typeof gen === "string") {
          if (gen === SdlGeneratorID) {
            return new SdlGenerator();
          }
          throw new Error(`Unknown generator ID: ${gen}`);
        } else if (Array.isArray(gen)) {
          if (gen[0] === "@tailor/kysely-type") {
            return new KyselyGenerator(gen[1]);
          }
          throw new Error(`Unknown generator ID: ${gen[0]}`);
        }
        return gen as CodeGenerator<any, any, any, any>;
      }) || [];
  }

  async processGenerators(
    baseDir: string,
    types: TailorDBType[],
    resolvers: Resolver[],
  ) {
    await Promise.all(
      this.generators.map(async (gen) => {
        let typeResults: any = {};
        let resolverResults: any = {};

        for (const type of types) {
          typeResults[type.name] = await gen.processType(type);
        }
        if (gen.processTypes) {
          typeResults = await gen.processTypes(typeResults);
        }

        for (const resolver of resolvers) {
          resolverResults[resolver.name] = await gen.processResolver(resolver);
        }
        if (gen.processResolvers) {
          resolverResults = await gen.processResolvers(resolverResults);
        }

        const result = await gen.aggregate(
          { types: typeResults, resolvers: resolverResults },
          path.join(baseDir, gen.id),
        );
        Promise.all(
          result.files.map(async (file) => {
            fs.mkdirSync(path.dirname(file.path), { recursive: true });
            fs.writeFile(file.path, file.content, (err) => {
              if (err) {
                console.error(`Error writing file ${file.path}:`, err);
              } else {
                console.log(`Generated file: ${file.path}`);
              }
            });
          }),
        );
      }),
    );
  }
}

export function generate(
  config: WorkspaceConfig,
  options: GenerateOptions = { watch: false },
) {
  const manager = new GenerationManager(config);
  return manager.generate(options);
}
