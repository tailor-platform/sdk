import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { styleText } from "node:util";
import { defineCommand } from "citty";
import { defineApplication, type Application } from "@/cli/application";
import { loadConfig } from "@/cli/config-loader";
import {
  type CodeGenerator,
  type TailorDBNamespaceResult,
  type ResolverNamespaceResult,
  type GeneratorAuthInput,
} from "@/cli/generator/types";
import { generateUserTypes } from "@/cli/type-generator";
import { getDistDir, type AppConfig } from "@/configure/config";
import { type Generator } from "@/parser/generator-config";
import { type Executor } from "@/parser/service/executor";
import { type Resolver } from "@/parser/service/resolver";
import { commonArgs, withCommonArgs } from "../args";
import { DependencyWatcher } from "./watch";
import type { GenerateOptions } from "./options";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

export type { CodeGenerator } from "@/cli/generator/types";

interface TypeInfo {
  types: Record<string, ParsedTailorDBType>;
  sourceInfo: Record<string, { filePath: string; exportName: string }>;
}
export class GenerationManager {
  public readonly application: Application;
  private services: {
    tailordb: Record<string, TypeInfo>;
    resolver: Record<string, Record<string, Resolver>>;
    executor: Record<string, Executor>;
  } = { tailordb: {}, resolver: {}, executor: {} };
  private readonly baseDir;

  constructor(
    config: AppConfig,
    private generators: Generator[] = [],
    private configPath?: string,
  ) {
    this.application = defineApplication(config);
    this.baseDir = path.join(getDistDir(), "generated");
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  async generate(watch: boolean) {
    console.log("");
    console.log(
      "Generation for application:",
      styleText("cyanBright", this.application.config.name),
    );
    console.log("");

    // Initialize data structure
    const app = this.application;

    for (const db of app.tailorDBServices) {
      const namespace = db.namespace;
      try {
        await db.loadTypes();
        this.services.tailordb[namespace] = {
          types: db.getTypes(),
          sourceInfo: db.getTypeSourceInfo(),
        };
      } catch (error) {
        console.error(
          styleText("red", "Error loading types for TailorDB service"),
          styleText("redBright", namespace),
        );
        console.error(error);
        if (!watch) {
          throw error;
        }
      }
    }

    // Resolver services
    for (const resolverService of app.resolverServices) {
      const namespace = resolverService.namespace;
      try {
        await resolverService.loadResolvers();
        this.services.resolver[namespace] = {};
        Object.entries(resolverService.getResolvers()).forEach(
          ([_, resolver]) => {
            this.services.resolver[namespace][resolver.name] = resolver;
          },
        );
      } catch (error) {
        console.error(
          styleText("red", "Error loading resolvers for Resolver service"),
          styleText("redBright", namespace),
        );
        console.error(error);
        if (!watch) {
          throw error;
        }
      }
    }

    // Auth service
    if (app.authService) {
      await app.authService.resolveNamespaces();
    }

    // Executor services
    const executors = await this.application.executorService?.loadExecutors();
    Object.entries(executors ?? {}).forEach(([filePath, executor]) => {
      this.services.executor[filePath] = executor as Executor;
    });

    await this.processGenerators();
  }

  // Store results for each generator, service type, and namespace
  private generatorResults: Record<
    /* generator */ string,
    {
      tailordbResults: Record<
        /* namespace */ string,
        Record</* type */ string, any>
      >;
      resolverResults: Record<
        /* namespace */ string,
        Record</* resolver */ string, any>
      >;
      tailordbNamespaceResults: Record</* namespace */ string, any>;
      resolverNamespaceResults: Record</* namespace */ string, any>;
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
        tailordbResults: {},
        resolverResults: {},
        tailordbNamespaceResults: {},
        resolverNamespaceResults: {},
        executorResults: {},
      };

      for (const [namespace, types] of Object.entries(this.services.tailordb)) {
        await this.processTailorDBNamespace(gen, namespace, types);
      }

      // Process Resolver namespaces
      for (const [namespace, resolvers] of Object.entries(
        this.services.resolver,
      )) {
        await this.processResolverNamespace(gen, namespace, resolvers);
      }

      // Process Executors
      await this.processExecutors(gen);

      // Aggregate all results
      await this.aggregate(gen);
    } catch (error) {
      console.error(
        styleText("red", "Error processing generator"),
        styleText("redBright", gen.id),
      );
      console.error(error);
    }
  }

  async processTailorDBNamespace(
    gen: CodeGenerator,
    namespace: string,
    typeInfo: TypeInfo,
  ) {
    const results = this.generatorResults[gen.id];
    results.tailordbResults[namespace] = {};

    await Promise.allSettled(
      Object.entries(typeInfo.types).map(async ([typeName, type]) => {
        try {
          results.tailordbResults[namespace][typeName] = await gen.processType({
            type,
            namespace,
            source: typeInfo.sourceInfo[typeName],
          });
        } catch (error) {
          console.error(
            styleText("red", `Error processing type`),
            styleText("redBright", typeName),
            styleText("red", `in ${namespace} with generator ${gen.id}`),
          );
          console.error(error);
        }
      }),
    );

    // Process namespace summary if available
    if (gen.processTailorDBNamespace) {
      try {
        results.tailordbNamespaceResults[namespace] =
          await gen.processTailorDBNamespace({
            namespace,
            types: results.tailordbResults[namespace],
          });
      } catch (error) {
        console.error(
          styleText("red", `Error processing TailorDB namespace`),
          styleText("redBright", namespace),
          styleText("red", `with generator ${gen.id}`),
        );
        console.error(error);
      }
    } else {
      results.tailordbNamespaceResults[namespace] =
        results.tailordbResults[namespace];
    }
  }

  async processResolverNamespace(
    gen: CodeGenerator,
    namespace: string,
    resolvers: Record<string, Resolver>,
  ) {
    const results = this.generatorResults[gen.id];
    results.resolverResults[namespace] = {};

    // Process individual resolvers
    await Promise.allSettled(
      Object.entries(resolvers).map(async ([resolverName, resolver]) => {
        try {
          results.resolverResults[namespace][resolverName] =
            await gen.processResolver({
              resolver,
              namespace,
            });
        } catch (error) {
          console.error(
            styleText("red", `Error processing resolver`),
            styleText("redBright", resolverName),
            styleText("red", `in ${namespace} with generator ${gen.id}`),
          );
          console.error(error);
        }
      }),
    );

    // Process namespace summary if available
    if (gen.processResolverNamespace) {
      try {
        results.resolverNamespaceResults[namespace] =
          await gen.processResolverNamespace({
            namespace,
            resolvers: results.resolverResults[namespace],
          });
      } catch (error) {
        console.error(
          styleText("red", `Error processing Resolver namespace`),
          styleText("redBright", namespace),
          styleText("red", `with generator ${gen.id}`),
        );
        console.error(error);
      }
    } else {
      results.resolverNamespaceResults[namespace] =
        results.resolverResults[namespace];
    }
  }

  async processExecutors(gen: CodeGenerator) {
    const results = this.generatorResults[gen.id];

    // Process individual executors
    await Promise.allSettled(
      Object.entries(this.services.executor).map(
        async ([executorId, executor]) => {
          try {
            results.executorResults[executorId] =
              await gen.processExecutor(executor);
          } catch (error) {
            console.error(
              styleText("red", `Error processing executor`),
              styleText("redBright", executor.name),
              styleText("red", `with generator ${gen.id}`),
            );
            console.error(error);
          }
        },
      ),
    );
  }

  private getAuthInput(): GeneratorAuthInput | undefined {
    const authService = this.application.authService;
    if (!authService) return undefined;

    const config = authService.config;
    return {
      name: config.name,
      userProfile: authService.userProfile
        ? {
            typeName: authService.userProfile.type.name,
            namespace: authService.userProfile.namespace,
            usernameField: authService.userProfile.usernameField,
          }
        : undefined,
      machineUsers: config.machineUsers,
      oauth2Clients: config.oauth2Clients,
      idProvider: config.idProvider,
    };
  }

  async aggregate(gen: CodeGenerator) {
    const results = this.generatorResults[gen.id];

    const tailordbResults: TailorDBNamespaceResult<any>[] = [];
    const resolverResults: ResolverNamespaceResult<any>[] = [];

    // Collect TailorDB namespace results
    for (const [namespace, types] of Object.entries(
      results.tailordbNamespaceResults,
    )) {
      tailordbResults.push({
        namespace,
        types,
      });
    }

    // Collect Resolver namespace results
    for (const [namespace, resolvers] of Object.entries(
      results.resolverNamespaceResults,
    )) {
      resolverResults.push({
        namespace,
        resolvers,
      });
    }
    const input = {
      tailordb: tailordbResults,
      resolver: resolverResults,
      auth: this.getAuthInput(),
    };

    // Call generator's aggregate method
    const result = await gen.aggregate({
      input,
      executorInputs: Object.values(results.executorResults),
      baseDir: path.join(this.baseDir, gen.id),
    });

    // Write generated files
    await Promise.all(
      result.files.map(async (file) => {
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        return new Promise<void>((resolve, reject) => {
          if (file.skipIfExists && fs.existsSync(file.path)) {
            const relativePath = path.relative(process.cwd(), file.path);
            console.log(
              styleText("gray", `${gen.id} | skip existing: ${relativePath}`),
            );
            return resolve();
          }

          fs.writeFile(file.path, file.content, (err) => {
            if (err) {
              const relativePath = path.relative(process.cwd(), file.path);
              console.error(
                styleText("red", "Error writing file"),
                styleText("redBright", relativePath),
              );
              console.error(err);
              reject(err);
            } else {
              const relativePath = path.relative(process.cwd(), file.path);
              console.log(
                `${gen.id} | generate:`,
                styleText("green", relativePath),
              );
              // Set executable permission if requested
              if (file.executable) {
                fs.chmod(file.path, 0o755, (chmodErr) => {
                  if (chmodErr) {
                    const relativePath = path.relative(
                      process.cwd(),
                      file.path,
                    );
                    console.error(
                      styleText(
                        "red",
                        "Error setting executable permission on",
                      ),
                      styleText("redBright", relativePath),
                    );
                    console.error(chmodErr);
                    reject(chmodErr);
                  } else {
                    resolve();
                  }
                });
              } else {
                resolve();
              }
            }
          });
        });
      }),
    );
    console.log("");
  }

  private watcher: DependencyWatcher | null = null;
  async watch() {
    this.watcher = new DependencyWatcher();

    // Set up restart callback
    this.watcher.setRestartCallback(() => {
      this.restartWatchProcess();
    });

    // Watch config file if available
    if (this.configPath) {
      await this.watcher.addWatchGroup("Config", [this.configPath]);
    }

    // Watch application services
    const app = this.application;

    // Watch TailorDB services
    for (const db of app.tailorDBServices) {
      const dbNamespace = db.namespace;
      await this.watcher?.addWatchGroup(
        `TailorDB/${dbNamespace}`,
        db.config.files,
      );
    }

    // Watch Resolver services
    for (const resolverService of app.resolverServices) {
      const resolverNamespace = resolverService.namespace;
      await this.watcher?.addWatchGroup(
        `Resolver/${resolverNamespace}`,
        resolverService["config"].files,
      );
    }

    // Keep the process running
    await new Promise(() => {});
  }

  private async restartWatchProcess() {
    console.log("");
    console.log(
      styleText("yellow", "Restarting watch process to clear module cache..."),
    );
    console.log("");

    // Clean up watcher first
    if (this.watcher) {
      await this.watcher.stop();
    }

    // Spawn a new process with the same arguments
    const args = process.argv.slice(2);
    const env = {
      ...process.env,
      TAILOR_WATCH_GENERATION: (
        parseInt(process.env.TAILOR_WATCH_GENERATION || "0", 10) + 1
      ).toString(),
    };

    const child = spawn(process.argv[0], [process.argv[1], ...args], {
      stdio: "inherit",
      env,
      detached: false,
    });

    // Forward signals to child
    const forwardSignal = (signal: NodeJS.Signals) => {
      child.kill(signal);
    };

    process.on("SIGINT", forwardSignal);
    process.on("SIGTERM", forwardSignal);

    // Wait for child to exit, then exit parent
    child.on("exit", (code) => {
      process.exit(code || 0);
    });

    // Don't exit immediately - let child handle everything
  }
}

export async function generate(options?: GenerateOptions) {
  // Load and validate options
  const { config, generators, configPath } = await loadConfig(
    options?.configPath,
  );
  const watch = options?.watch ?? false;

  // Generate user types from loaded config
  await generateUserTypes(config, configPath);
  const manager = new GenerationManager(config, generators, configPath);
  await manager.generate(watch);
  if (watch) {
    await manager.watch();
  }
}

export const generateCommand = defineCommand({
  meta: {
    name: "generate",
    description: "Generate files using Tailor configuration",
  },
  args: {
    ...commonArgs,
    config: {
      type: "string",
      description: "Path to SDK config file",
      alias: "c",
      default: "tailor.config.ts",
    },
    watch: {
      type: "boolean",
      description: "Watch for type/resolver changes and regenerate",
      alias: "w",
      default: false,
    },
  },
  run: withCommonArgs(async (args) => {
    await generate({
      configPath: args.config,
      watch: args.watch,
    });
  }),
});
