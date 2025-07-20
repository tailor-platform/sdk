/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import path from "node:path";
import type { GenerateOptions, ApplyOptions } from "./options";
import { getDistDir, WorkspaceConfig } from "@/config";
import { defineWorkspace } from "@/workspace";
import { Resolver } from "@/services/pipeline/resolver";
import { TailorDBType } from "@/services/tailordb/schema";
import { measure } from "@/performance";
import {
  CodeGenerator,
  GeneratorInput,
  TailorDBNamespaceResult,
  PipelineNamespaceResult,
} from "./types";
import { SdlGenerator, SdlGeneratorID } from "./builtin/sdl";
import { KyselyGenerator } from "./builtin/kysely-type";
import { DbTypeGenerator } from "./builtin/db-type";
import { DependencyWatcher } from "./watch";
import { ManifestGenerator } from "./builtin/manifest";
import { TailorCtl } from "@/ctl";

type Workspace = ReturnType<typeof defineWorkspace>;

export class GenerationManager {
  public readonly workspace: Workspace;
  private generators: CodeGenerator<any, any, any, any>[] = [];
  // application毎、service種別毎、namespace毎に整理
  private applications: Record<
    string,
    {
      tailordbNamespaces: Record<string, Record<string, TailorDBType>>;
      pipelineNamespaces: Record<string, Record<string, Resolver>>;
    }
  > = {};
  private readonly baseDir;

  constructor(private readonly config: WorkspaceConfig) {
    this.workspace = defineWorkspace(config);
    this.baseDir = path.join(getDistDir(), "generated");
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  @measure
  private initGenerators() {
    if (this.generators.length > 0) {
      console.log(
        "[initGenerators] Generators already initialized, count:",
        this.generators.length,
      );
      return;
    }

    console.log(
      "[initGenerators] Initializing generators, config has:",
      this.config.generators?.length || 0,
    );

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
          if (gen[0] === "@tailor/db-type") {
            return new DbTypeGenerator(gen[1]);
          }
          throw new Error(`Unknown generator ID: ${gen[0]}`);
        }

        if (gen instanceof ManifestGenerator) {
          gen.workspace = this.workspace;
          return gen;
        }

        return gen as CodeGenerator<any, any, any, any>;
      }) || [];
  }

  @measure
  async generate(_options: GenerateOptions) {
    console.log("Generation for workspace:", this.workspace.config.name);

    // application毎のデータ構造を初期化
    for (const app of this.workspace.applications) {
      const appNamespace = app.name;
      this.applications[appNamespace] = {
        tailordbNamespaces: {},
        pipelineNamespaces: {},
      };

      // TailorDB services
      for (const db of app.tailorDBServices) {
        const namespace = db.namespace;
        const types = await db.loadTypes();
        if (types) {
          this.applications[appNamespace].tailordbNamespaces[namespace] = {};
          // flatten the nested structure
          Object.values(types).forEach((nsTypes) => {
            Object.entries(nsTypes).forEach(([typeName, type]) => {
              this.applications[appNamespace].tailordbNamespaces[namespace][
                typeName
              ] = type;
            });
          });
        }
      }

      // Pipeline services
      for (const pipelineService of app.pipelineResolverServices) {
        const namespace = pipelineService.namespace;
        await pipelineService.loadResolvers();
        this.applications[appNamespace].pipelineNamespaces[namespace] = {};
        Object.entries(pipelineService.getResolvers()).forEach(
          ([_, resolver]) => {
            this.applications[appNamespace].pipelineNamespaces[namespace][
              resolver.name
            ] = resolver;
          },
        );
      }
    }

    this.initGenerators();
    await this.processGenerators();
  }

  // generator毎、application毎、service種別毎、namespace毎の結果を格納
  private generatorResults: Record<
    /* generator */ string,
    Record<
      /* application */ string,
      {
        tailordbResults: Record<
          /* namespace */ string,
          Record</* type */ string, any>
        >;
        pipelineResults: Record<
          /* namespace */ string,
          Record</* resolver */ string, any>
        >;
        tailordbNamespaceResults: Record</* namespace */ string, any>;
        pipelineNamespaceResults: Record</* namespace */ string, any>;
      }
    >
  > = {};

  async processGenerators() {
    await Promise.allSettled(
      this.generators.map(async (gen) => await this.processGenerator(gen)),
    );
  }

  async processGenerator(gen: CodeGenerator) {
    try {
      this.generatorResults[gen.id] = {};

      // Process each application
      for (const [appNamespace, appData] of Object.entries(this.applications)) {
        this.generatorResults[gen.id][appNamespace] = {
          tailordbResults: {},
          pipelineResults: {},
          tailordbNamespaceResults: {},
          pipelineNamespaceResults: {},
        };

        // Process TailorDB namespaces
        for (const [namespace, types] of Object.entries(
          appData.tailordbNamespaces,
        )) {
          await this.processTailorDBNamespace(
            gen,
            appNamespace,
            namespace,
            types,
          );
        }

        // Process Pipeline namespaces
        for (const [namespace, resolvers] of Object.entries(
          appData.pipelineNamespaces,
        )) {
          await this.processPipelineNamespace(
            gen,
            appNamespace,
            namespace,
            resolvers,
          );
        }
      }

      // Aggregate all results
      await this.aggregate(gen);
    } catch (error) {
      console.error(`Error processing generator ${gen.id}:`, error);
    }
  }

  async processTailorDBNamespace(
    gen: CodeGenerator,
    appNamespace: string,
    namespace: string,
    types: Record<string, TailorDBType>,
  ) {
    const results = this.generatorResults[gen.id][appNamespace];
    results.tailordbResults[namespace] = {};

    // Process individual types
    await Promise.allSettled(
      Object.entries(types).map(async ([typeName, type]) => {
        try {
          results.tailordbResults[namespace][typeName] = await gen.processType(
            type,
            appNamespace,
            namespace,
          );
        } catch (error) {
          console.error(
            `Error processing type ${typeName} in ${appNamespace}/${namespace} with generator ${gen.id}:`,
            error,
          );
        }
      }),
    );

    // Process namespace summary if available
    if (gen.processTailorDBNamespace) {
      try {
        results.tailordbNamespaceResults[namespace] =
          await gen.processTailorDBNamespace(
            appNamespace,
            namespace,
            results.tailordbResults[namespace],
          );
      } catch (error) {
        console.error(
          `Error processing TailorDB namespace ${namespace} in ${appNamespace} with generator ${gen.id}:`,
          error,
        );
      }
    } else {
      results.tailordbNamespaceResults[namespace] =
        results.tailordbResults[namespace];
    }
  }

  async processPipelineNamespace(
    gen: CodeGenerator,
    appNamespace: string,
    namespace: string,
    resolvers: Record<string, Resolver>,
  ) {
    const results = this.generatorResults[gen.id][appNamespace];
    results.pipelineResults[namespace] = {};

    // Process individual resolvers
    await Promise.allSettled(
      Object.entries(resolvers).map(async ([resolverName, resolver]) => {
        try {
          results.pipelineResults[namespace][resolverName] =
            await gen.processResolver(resolver, appNamespace, namespace);
        } catch (error) {
          console.error(
            `Error processing resolver ${resolverName} in ${appNamespace}/${namespace} with generator ${gen.id}:`,
            error,
          );
        }
      }),
    );

    // Process namespace summary if available
    if (gen.processPipelineNamespace) {
      try {
        results.pipelineNamespaceResults[namespace] =
          await gen.processPipelineNamespace(
            appNamespace,
            namespace,
            results.pipelineResults[namespace],
          );
      } catch (error) {
        console.error(
          `Error processing Pipeline namespace ${namespace} in ${appNamespace} with generator ${gen.id}:`,
          error,
        );
      }
    } else {
      results.pipelineNamespaceResults[namespace] =
        results.pipelineResults[namespace];
    }
  }

  async aggregate(gen: CodeGenerator) {
    // Build inputs for each application
    const inputs: GeneratorInput<any, any>[] = [];

    for (const [appNamespace, results] of Object.entries(
      this.generatorResults[gen.id],
    )) {
      const tailordbResults: TailorDBNamespaceResult<any>[] = [];
      const pipelineResults: PipelineNamespaceResult<any>[] = [];

      // Collect TailorDB namespace results
      for (const [namespace, types] of Object.entries(
        results.tailordbNamespaceResults,
      )) {
        tailordbResults.push({
          namespace,
          types,
        });
      }

      // Collect Pipeline namespace results
      for (const [namespace, resolvers] of Object.entries(
        results.pipelineNamespaceResults,
      )) {
        pipelineResults.push({
          namespace,
          resolvers,
        });
      }

      inputs.push({
        applicationNamespace: appNamespace,
        tailordb: tailordbResults,
        pipeline: pipelineResults,
      });
    }

    // Call generator's aggregate method
    const result = await gen.aggregate(inputs, path.join(this.baseDir, gen.id));

    // Write generated files
    await Promise.all(
      result.files.map(async (file) => {
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        return new Promise<void>((resolve, reject) => {
          fs.writeFile(file.path, file.content, (err) => {
            if (err) {
              console.error(`Error writing file ${file.path}:`, err);
              reject(err);
            } else {
              console.log(`Generated file: ${file.path}`);
              resolve();
            }
          });
        });
      }),
    );
  }

  private watcher: DependencyWatcher | null = null;
  async watch() {
    this.watcher = new DependencyWatcher();

    // Watch for each application
    for (const app of this.workspace.applications) {
      const appNamespace = app.name;

      // Watch TailorDB services
      for (const db of app.tailorDBServices) {
        const dbNamespace = db.namespace;
        this.watcher?.addWatchGroup(
          `TailorDB__${appNamespace}__${dbNamespace}`,
          db.config.files,
          async ({ timestamp }, { affectedFiles }) => {
            // Reload affected types
            for (const file of affectedFiles) {
              const types = await db.loadTypesForFile(file, timestamp);
              Object.entries(types).forEach(([typeName, type]) => {
                this.applications[appNamespace].tailordbNamespaces[dbNamespace][
                  typeName
                ] = type;
              });
            }

            // Process with all generators
            for (const gen of this.generators) {
              await this.processTailorDBNamespace(
                gen,
                appNamespace,
                dbNamespace,
                this.applications[appNamespace].tailordbNamespaces[dbNamespace],
              );
              await this.aggregate(gen);
            }
          },
        );
      }

      // Watch Pipeline services
      for (const pipeline of app.pipelineResolverServices) {
        const pipelineNamespace = pipeline.namespace;
        this.watcher?.addWatchGroup(
          `Pipeline__${appNamespace}__${pipelineNamespace}`,
          pipeline["config"].files,
          async ({ timestamp }, { affectedFiles }) => {
            // Reload affected resolvers
            for (const file of affectedFiles) {
              const resolver = await pipeline.loadResolverForFile(
                file,
                timestamp,
              );
              this.applications[appNamespace].pipelineNamespaces[
                pipelineNamespace
              ][resolver.name] = resolver;
            }

            // Process with all generators
            for (const gen of this.generators) {
              await this.processPipelineNamespace(
                gen,
                appNamespace,
                pipelineNamespace,
                this.applications[appNamespace].pipelineNamespaces[
                  pipelineNamespace
                ],
              );
              await this.aggregate(gen);
            }
          },
        );
      }
    }
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

export async function apply(config: WorkspaceConfig, options: ApplyOptions) {
  const applyConfig: WorkspaceConfig = {
    ...config,
    generators: [new ManifestGenerator(options)],
  };
  await new GenerationManager(applyConfig).generate({
    ...options,
    watch: false,
  });

  const distDir = getDistDir();
  if (!distDir) {
    throw new Error("Distribution directory is not configured");
  }
  const tailorCtl = new TailorCtl(options);
  tailorCtl.upsertWorkspace(applyConfig);
  tailorCtl.apply(path.join(distDir, "manifest.cue"));
}
