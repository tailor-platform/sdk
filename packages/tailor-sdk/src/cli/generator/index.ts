import * as fs from "node:fs";
import * as path from "node:path";
import type { GenerateOptions } from "./options";
import { getDistDir, type AppConfig } from "@/configure/config";
import { loadConfig } from "@/cli/config-loader";
import { type Generator } from "@/parser/generator-config";
import { defineApplication, type Application } from "@/cli/application";
import { type Resolver } from "@/parser/service/pipeline";
import { type TailorDBType } from "@/configure/services/tailordb/schema";
import { type Executor } from "@/configure/services/executor/types";
import {
  type CodeGenerator,
  type GeneratorInput,
  type TailorDBNamespaceResult,
  type PipelineNamespaceResult,
} from "@/cli/generator/types";
import { DependencyWatcher } from "./watch";
import { generateUserTypes } from "@/cli/type-generator";

export type { CodeGenerator } from "@/cli/generator/types";

export class GenerationManager {
  public readonly application: Application;
  // Organized by application, service type, and namespace
  private applications: Record<
    string,
    {
      tailordbNamespaces: Record<string, Record<string, TailorDBType>>;
      pipelineNamespaces: Record<string, Record<string, Resolver>>;
    }
  > = {};
  private executors: Record<string, Executor> = {};
  private readonly baseDir;

  constructor(
    config: AppConfig,
    private generators: Generator[] = [],
  ) {
    this.application = defineApplication(config);
    this.baseDir = path.join(getDistDir(), "generated");
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  async generate(options: GenerateOptions) {
    console.log(
      "Generation for application:",
      this.application.config.name,
      "workspace ID:",
      this.application.config.workspaceId,
    );

    // Initialize data structure for each application
    for (const app of this.application.applications) {
      const appNamespace = app.name;
      this.applications[appNamespace] = {
        tailordbNamespaces: {},
        pipelineNamespaces: {},
      };

      // TailorDB services
      for (const db of app.tailorDBServices) {
        const namespace = db.namespace;
        try {
          const types = await db.loadTypes();
          if (types) {
            this.applications[appNamespace].tailordbNamespaces[namespace] = {};
            // flatten the nested structure
            Object.values(types).forEach((nsTypes) => {
              Object.entries(nsTypes as Record<string, TailorDBType>).forEach(
                ([typeName, type]) => {
                  this.applications[appNamespace].tailordbNamespaces[namespace][
                    typeName
                  ] = type;
                },
              );
            });
          }
        } catch (error) {
          console.error(
            `Error loading types for TailorDB service ${namespace}:`,
            error,
          );
          if (!options.watch) {
            throw error;
          }
        }
      }

      // Pipeline services
      for (const pipelineService of app.pipelineResolverServices) {
        const namespace = pipelineService.namespace;
        try {
          await pipelineService.loadResolvers();
          this.applications[appNamespace].pipelineNamespaces[namespace] = {};
          Object.entries(pipelineService.getResolvers()).forEach(
            ([_, resolver]) => {
              this.applications[appNamespace].pipelineNamespaces[namespace][
                resolver.name
              ] = resolver;
            },
          );
        } catch (error) {
          console.error(
            `Error loading resolvers for Pipeline service ${namespace}:`,
            error,
          );
          if (!options.watch) {
            throw error;
          }
        }
      }

      // Auth service
      if (app.authService) {
        await app.authService.resolveNamespaces();
      }
    }

    // Executor services
    const executors = await this.application.executorService?.loadExecutors();
    Object.entries(executors ?? {}).forEach(([filePath, executor]) => {
      this.executors[filePath] = executor as Executor;
    });

    await this.processGenerators();
  }

  // Store results for each generator, application, service type, and namespace
  private generatorResults: Record<
    /* generator */ string,
    {
      application: Record<
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
      >;
      executorResults: Record</* executor */ string, any>;
    }
  > = {};

  async processGenerators() {
    await Promise.allSettled(
      this.generators.map(async (gen) => await this.processGenerator(gen)),
    );
  }

  async processGenerator(gen: CodeGenerator) {
    try {
      this.generatorResults[gen.id] = {
        application: {},
        executorResults: {},
      };

      // Process each application
      for (const [appNamespace, appData] of Object.entries(this.applications)) {
        this.generatorResults[gen.id].application[appNamespace] = {
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

        // Process Executors
        await this.processExecutors(gen);
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
    const results = this.generatorResults[gen.id].application[appNamespace];
    results.tailordbResults[namespace] = {};

    // Process individual types
    await Promise.allSettled(
      Object.entries(types).map(async ([typeName, type]) => {
        try {
          results.tailordbResults[namespace][typeName] = await gen.processType({
            type,
            applicationNamespace: appNamespace,
            namespace,
          });
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
          await gen.processTailorDBNamespace({
            applicationNamespace: appNamespace,
            namespace,
            types: results.tailordbResults[namespace],
          });
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
    const results = this.generatorResults[gen.id].application[appNamespace];
    results.pipelineResults[namespace] = {};

    // Process individual resolvers
    await Promise.allSettled(
      Object.entries(resolvers).map(async ([resolverName, resolver]) => {
        try {
          results.pipelineResults[namespace][resolverName] =
            await gen.processResolver({
              resolver,
              applicationNamespace: appNamespace,
              namespace,
            });
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
          await gen.processPipelineNamespace({
            applicationNamespace: appNamespace,
            namespace,
            resolvers: results.pipelineResults[namespace],
          });
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

  async processExecutors(gen: CodeGenerator) {
    const results = this.generatorResults[gen.id];

    // Process individual executors
    await Promise.allSettled(
      Object.entries(this.executors).map(async ([executorId, executor]) => {
        try {
          results.executorResults[executorId] =
            await gen.processExecutor(executor);
        } catch (error) {
          console.error(
            `Error processing executor ${executor.name} with generator ${gen.id}:`,
            error,
          );
        }
      }),
    );
  }

  async aggregate(gen: CodeGenerator) {
    // Build inputs for each application
    const inputs: GeneratorInput<any, any>[] = [];

    for (const [appNamespace, results] of Object.entries(
      this.generatorResults[gen.id].application,
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
    // executor: Object.values(results.executorResults),

    // Call generator's aggregate method
    const result = await gen.aggregate({
      inputs,
      executorInputs: Object.values(
        this.generatorResults[gen.id].executorResults,
      ),
      baseDir: path.join(this.baseDir, gen.id),
    });

    // Write generated files
    await Promise.all(
      result.files.map(async (file) => {
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        return new Promise<void>((resolve, reject) => {
          if (file.skipIfExists && fs.existsSync(file.path)) {
            console.log(`Skipping existing file: ${file.path}`);
            return resolve();
          }

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
    for (const app of this.application.applications) {
      const appNamespace = app.name;

      // Watch TailorDB services
      for (const db of app.tailorDBServices) {
        const dbNamespace = db.namespace;
        this.watcher?.addWatchGroup(
          `TailorDB__${appNamespace}__${dbNamespace}`,
          db.config.files,
          async ({ timestamp }, { affectedFiles }) => {
            try {
              // Reload affected types
              for (const file of affectedFiles) {
                try {
                  const types = await db.loadTypesForFile(file, timestamp);
                  Object.entries(types as Record<string, TailorDBType>).forEach(
                    ([typeName, type]) => {
                      this.applications[appNamespace].tailordbNamespaces[
                        dbNamespace
                      ][typeName] = type;
                    },
                  );
                } catch (error) {
                  console.error(
                    `Error loading types from file ${file}:`,
                    error,
                  );
                  continue;
                }
              }

              // Process with all generators
              for (const gen of this.generators) {
                await this.processTailorDBNamespace(
                  gen,
                  appNamespace,
                  dbNamespace,
                  this.applications[appNamespace].tailordbNamespaces[
                    dbNamespace
                  ],
                );
                await this.aggregate(gen);
              }
            } catch (error) {
              console.error(
                `Error processing TailorDB changes for ${appNamespace}/${dbNamespace}:`,
                error,
              );
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
            try {
              // Reload affected resolvers
              for (const file of affectedFiles) {
                try {
                  const resolver = await pipeline.loadResolverForFile(
                    file,
                    timestamp,
                  );
                  this.applications[appNamespace].pipelineNamespaces[
                    pipelineNamespace
                  ][resolver.name] = resolver;
                } catch (error) {
                  console.error(
                    `Error loading resolver from file ${file}:`,
                    error,
                  );
                  // Continue with other files in watch mode
                  continue;
                }
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
            } catch (error) {
              console.error(
                `Error processing Pipeline changes for ${appNamespace}/${pipelineNamespace}:`,
                error,
              );
            }
          },
        );
      }
    }
  }
}

export async function generate(
  configPath: string,
  options: GenerateOptions = { watch: false },
) {
  const { config, generators } = await loadConfig(configPath);

  // Generate user types from loaded config
  await generateUserTypes(config, configPath);
  const manager = new GenerationManager(config, generators);
  await manager.generate(options);
  if (options.watch) {
    await manager.watch();
  }
}
