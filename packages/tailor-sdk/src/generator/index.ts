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
import { DependencyWatcher } from "./watch";

type Workspace = ReturnType<typeof defineWorkspace>;

class GenerationManager {
  private workspace: Workspace;
  private generators: CodeGenerator<any, any, any, any>[] = [];
  private types: Record<string, Record<string, TailorDBType>> = {};
  private resolvers: Record<string, Resolver> = {};
  private readonly baseDir;

  constructor(private readonly config: WorkspaceConfig) {
    this.workspace = defineWorkspace(config);
    this.baseDir = path.join(getDistDir(), "generated");
    fs.mkdirSync(this.baseDir, { recursive: true });
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

  @measure
  async generate(_options: GenerateOptions) {
    console.log("Applying workspace:", this.workspace.config.name);
    console.log(
      "Applications:",
      this.workspace.applications.map((app) => app.name),
    );

    for (const app of this.workspace.applications) {
      for (const db of app.tailorDBServices) {
        console.log("TailorDB Service:", db.namespace);
        this.types = (await db.loadTypes())!;
      }

      console.log(
        "Pipeline Services:",
        app.pipelineResolverServices.map((service) => service.namespace),
      );
      for (const pipelineService of app.pipelineResolverServices) {
        await pipelineService.loadResolvers();
        Object.entries(pipelineService.getResolvers()).forEach(
          ([filename, resolver]) => {
            this.resolvers[filename] = resolver;
          },
        );
      }
    }

    this.initGenerators();
    this.processGenerators();
  }

  private typeResults: Record<
    /* generator */ string,
    Record</* type */ string, any>
  > = {};
  private typesResult: Record</* generator */ string, any> = {};
  private resolverResults: Record<
    /* generator */ string,
    Record</* resolver */ string, any>
  > = {};
  private resolversResult: Record</* generator */ string, any> = {};

  async processGenerators() {
    await Promise.all(
      this.generators.map(async (gen) => await this.processGenerator(gen)),
    );
  }

  async processGenerator(gen: CodeGenerator) {
    await Promise.all([
      (async () => {
        await this.processSingleTypes(gen);
        this.typesResult[gen.id] = await this.summarizeTypes(gen);
      })(),
      (async () => {
        await this.processSingleResolvers(gen);
        this.resolversResult[gen.id] = await this.summarizeResolvers(gen);
      })(),
    ]);
    await this.aggregate(gen);
  }

  async processSingleTypes(gen: CodeGenerator) {
    this.typeResults[gen.id] = this.typeResults[gen.id] || {};
    await Promise.all(
      Object.values(this.types).map(async (types) => {
        Object.values(types).forEach(async (type) => {
          this.typeResults[gen.id][type.name] = await gen.processType(type);
        });
      }),
    );
  }

  async processSingleResolvers(gen: CodeGenerator) {
    this.resolverResults[gen.id] = this.resolverResults[gen.id] || {};
    await Promise.all(
      Object.values(this.resolvers).map(async (resolver) => {
        this.resolverResults[gen.id][resolver.name] =
          await gen.processResolver(resolver);
      }),
    );
  }

  async summarizeTypes(gen: CodeGenerator) {
    if (gen.processTypes) {
      return await gen.processTypes(this.typeResults[gen.id]);
    }
    return this.typeResults[gen.id];
  }

  async summarizeResolvers(gen: CodeGenerator) {
    if (gen.processResolvers) {
      return await gen.processResolvers(this.resolverResults[gen.id]);
    }
    return this.resolverResults[gen.id];
  }

  async aggregate(gen: CodeGenerator) {
    const result = await gen.aggregate(
      {
        types: this.typesResult[gen.id],
        resolvers: this.resolversResult[gen.id],
      },
      path.join(this.baseDir, gen.id),
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
  }

  private watcher: DependencyWatcher | null = null;
  async watch() {
    this.watcher = new DependencyWatcher();

    Object.values(this.config.app).map((app) => {
      Object.entries(app.db).forEach(([namespace, db]) => {
        this.watcher?.addWatchGroup(
          `TailorDB__${namespace}`,
          db.files,
          async (_, { affectedFiles }) => {
            for (const app of this.workspace.applications) {
              for (const db of app.tailorDBServices) {
                for (const file of affectedFiles) {
                  this.types[file] = await db.loadTypesForFile(file);
                }
              }
            }

            for (const gen of this.generators) {
              for (const file of affectedFiles) {
                for (const type of Object.values(this.types[file])) {
                  this.typeResults[gen.id][type.name] =
                    await gen.processType(type);
                }
              }

              this.typesResult[gen.id] = await this.summarizeTypes(gen);
              await this.aggregate(gen);
            }
          },
        );
      });
      Object.entries(app.resolver).forEach(([namespace, service]) => {
        this.watcher?.addWatchGroup(
          `Pipeline__${namespace}`,
          service.files,
          async (_, { affectedFiles }) => {
            for (const app of this.workspace.applications) {
              for (const pipeline of app.pipelineResolverServices) {
                for (const file of affectedFiles) {
                  this.resolvers[file] =
                    await pipeline.loadResolverForFile(file);
                }
              }
            }

            for (const gen of this.generators) {
              for (const file of affectedFiles) {
                const resolver = this.resolvers[file];
                this.resolverResults[gen.id][resolver.name] =
                  await gen.processResolver(resolver);
              }
              this.resolversResult[gen.id] = await this.summarizeResolvers(gen);
              await this.aggregate(gen);
            }
          },
        );
      });
    });
  }
}

export async function generate(
  config: WorkspaceConfig,
  options: GenerateOptions = { watch: false },
) {
  const manager = new GenerationManager(config);
  await manager.generate(options);
  if (options.watch) {
    await manager.watch();
  }
}
