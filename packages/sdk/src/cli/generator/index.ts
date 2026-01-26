import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { defineCommand } from "citty";
import * as path from "pathe";
import { defineApplication, type Application } from "@/cli/application";
import { loadConfig } from "@/cli/config-loader";
import {
  type AnyCodeGenerator,
  type TailorDBNamespaceResult,
  type ResolverNamespaceResult,
  type GeneratorAuthInput,
  type DependencyKind,
  hasDependency,
} from "@/cli/generator/types";
import { generateUserTypes } from "@/cli/type-generator";
import { logger, styles } from "@/cli/utils/logger";
import { getDistDir } from "@/configure/config";
import { type AppConfig } from "@/parser/app-config";
import { type Generator } from "@/parser/generator-config";
import { type Executor } from "@/parser/service/executor";
import { type Resolver } from "@/parser/service/resolver";
import { commonArgs, withCommonArgs } from "../args";
import { createDependencyWatcher, type DependencyWatcher } from "./watch";
import type { GenerateOptions } from "./options";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

export type { CodeGenerator } from "@/cli/generator/types";

type TypeInfo = {
  types: Record<string, ParsedTailorDBType>;
  sourceInfo: Record<string, { filePath: string; exportName: string }>;
};

/**
 * Generation manager type.
 */
export type GenerationManager = {
  readonly application: Application;
  generate: (watch: boolean) => Promise<void>;
  watch: () => Promise<void>;
};

type GeneratorResults = Record<
  /* generator */ string,
  {
    tailordbResults: Record</* namespace */ string, Record</* type */ string, unknown>>;
    resolverResults: Record</* namespace */ string, Record</* resolver */ string, unknown>>;
    tailordbNamespaceResults: Record</* namespace */ string, unknown>;
    resolverNamespaceResults: Record</* namespace */ string, unknown>;
    executorResults: Record</* executor */ string, unknown>;
  }
>;

/**
 * Creates a generation manager.
 * @param config - Application configuration
 * @param generators - List of generators
 * @param configPath - Path to the configuration file
 * @returns GenerationManager instance
 */
export function createGenerationManager(
  config: AppConfig,
  generators: Generator[] = [],
  configPath?: string,
): GenerationManager {
  const application = defineApplication(config);
  const baseDir = path.join(getDistDir(), "generated");
  fs.mkdirSync(baseDir, { recursive: true });

  const services: {
    tailordb: Record<string, TypeInfo>;
    resolver: Record<string, Record<string, Resolver>>;
    executor: Record<string, Executor>;
  } = { tailordb: {}, resolver: {}, executor: {} };

  let watcher: DependencyWatcher | null = null;
  const generatorResults: GeneratorResults = {};

  // Helper functions for dependency checking
  function getDeps(gen: AnyCodeGenerator): Set<DependencyKind> {
    return new Set(gen.dependencies);
  }

  function onlyHas(gen: AnyCodeGenerator, ...required: DependencyKind[]): boolean {
    const deps = getDeps(gen);
    return required.every((r) => deps.has(r)) && deps.size === required.length;
  }

  function hasAll(gen: AnyCodeGenerator, ...required: DependencyKind[]): boolean {
    return required.every((r) => getDeps(gen).has(r));
  }

  function hasNone(gen: AnyCodeGenerator, ...excluded: DependencyKind[]): boolean {
    return excluded.every((e) => !getDeps(gen).has(e));
  }

  function getAuthInput(): GeneratorAuthInput | undefined {
    const authService = application.authService;
    if (!authService) return undefined;

    const authConfig = authService.parsedConfig;
    const userProfile = authService.userProfile;
    return {
      name: authConfig.name,
      userProfile: userProfile
        ? {
            typeName: userProfile.type.name,
            namespace: userProfile.namespace,
            usernameField: userProfile.usernameField,
          }
        : undefined,
      machineUsers: authConfig.machineUsers,
      oauth2Clients: authConfig.oauth2Clients,
      idProvider: authConfig.idProvider,
    };
  }

  async function processTailorDBNamespace(
    gen: AnyCodeGenerator,
    namespace: string,
    typeInfo: TypeInfo,
  ): Promise<void> {
    const results = generatorResults[gen.id];
    results.tailordbResults[namespace] = {};

    // Check if generator has processType method
    if (!gen.processType) {
      return;
    }

    const processType = gen.processType;
    await Promise.allSettled(
      Object.entries(typeInfo.types).map(async ([typeName, type]) => {
        try {
          results.tailordbResults[namespace][typeName] = await processType({
            type,
            namespace,
            source: typeInfo.sourceInfo[typeName],
          });
        } catch (error) {
          logger.error(
            `Error processing type ${styles.bold(typeName)} in ${namespace} with generator ${gen.id}`,
          );
          logger.error(String(error));
        }
      }),
    );

    // Process namespace summary if available
    if ("processTailorDBNamespace" in gen && typeof gen.processTailorDBNamespace === "function") {
      try {
        results.tailordbNamespaceResults[namespace] = await gen.processTailorDBNamespace({
          namespace,
          types: results.tailordbResults[namespace],
        });
      } catch (error) {
        logger.error(
          `Error processing TailorDB namespace ${styles.bold(namespace)} with generator ${gen.id}`,
        );
        logger.error(String(error));
      }
    } else {
      results.tailordbNamespaceResults[namespace] = results.tailordbResults[namespace];
    }
  }

  async function processResolverNamespace(
    gen: AnyCodeGenerator,
    namespace: string,
    resolvers: Record<string, Resolver>,
  ): Promise<void> {
    const results = generatorResults[gen.id];
    results.resolverResults[namespace] = {};

    // Check if generator has processResolver method
    if (!gen.processResolver) {
      return;
    }

    const processResolver = gen.processResolver;
    // Process individual resolvers
    await Promise.allSettled(
      Object.entries(resolvers).map(async ([resolverName, resolver]) => {
        try {
          results.resolverResults[namespace][resolverName] = await processResolver({
            resolver,
            namespace,
          });
        } catch (error) {
          logger.error(
            `Error processing resolver ${styles.bold(resolverName)} in ${namespace} with generator ${gen.id}`,
          );
          logger.error(String(error));
        }
      }),
    );

    // Process namespace summary if available
    if ("processResolverNamespace" in gen && typeof gen.processResolverNamespace === "function") {
      try {
        results.resolverNamespaceResults[namespace] = await gen.processResolverNamespace({
          namespace,
          resolvers: results.resolverResults[namespace],
        });
      } catch (error) {
        logger.error(
          `Error processing Resolver namespace ${styles.bold(namespace)} with generator ${gen.id}`,
        );
        logger.error(String(error));
      }
    } else {
      results.resolverNamespaceResults[namespace] = results.resolverResults[namespace];
    }
  }

  async function processExecutors(gen: AnyCodeGenerator): Promise<void> {
    const results = generatorResults[gen.id];

    // Check if generator has processExecutor method
    if (!gen.processExecutor) {
      return;
    }

    const processExecutor = gen.processExecutor;
    // Process individual executors
    await Promise.allSettled(
      Object.entries(services.executor).map(async ([executorId, executor]) => {
        try {
          results.executorResults[executorId] = await processExecutor(executor);
        } catch (error) {
          logger.error(
            `Error processing executor ${styles.bold(executor.name)} with generator ${gen.id}`,
          );
          logger.error(String(error));
        }
      }),
    );
  }

  async function aggregate(gen: AnyCodeGenerator): Promise<void> {
    const results = generatorResults[gen.id];

    const tailordbResults: TailorDBNamespaceResult<unknown>[] = [];
    const resolverResults: ResolverNamespaceResult<unknown>[] = [];

    // Collect TailorDB namespace results
    for (const [namespace, types] of Object.entries(results.tailordbNamespaceResults)) {
      tailordbResults.push({
        namespace,
        types,
      });
    }

    // Collect Resolver namespace results
    for (const [namespace, resolvers] of Object.entries(results.resolverNamespaceResults)) {
      resolverResults.push({
        namespace,
        resolvers,
      });
    }

    // Build input based on generator dependencies
    const input: Record<string, unknown> = {
      auth: getAuthInput(),
    };

    if (hasDependency(gen, "tailordb")) {
      input.tailordb = tailordbResults;
    }
    if (hasDependency(gen, "resolver")) {
      input.resolver = resolverResults;
    }
    if (hasDependency(gen, "executor")) {
      input.executor = Object.values(results.executorResults);
    }

    // Call generator's aggregate method
    const result = await gen.aggregate({
      input: input as Parameters<typeof gen.aggregate>[0]["input"],
      baseDir: path.join(baseDir, gen.id),
      configPath: configPath ?? "tailor.config.ts",
    });

    // Write generated files
    await Promise.all(
      result.files.map(async (file) => {
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        return new Promise<void>((resolve, reject) => {
          if (file.skipIfExists && fs.existsSync(file.path)) {
            const relativePath = path.relative(process.cwd(), file.path);
            logger.debug(`${gen.id} | skip existing: ${relativePath}`);
            return resolve();
          }

          fs.writeFile(file.path, file.content, (err) => {
            if (err) {
              const relativePath = path.relative(process.cwd(), file.path);
              logger.error(`Error writing file ${styles.bold(relativePath)}`);
              logger.error(String(err));
              reject(err);
            } else {
              const relativePath = path.relative(process.cwd(), file.path);
              logger.log(`${gen.id} | generate: ${styles.success(relativePath)}`);
              // Set executable permission if requested
              if (file.executable) {
                fs.chmod(file.path, 0o755, (chmodErr) => {
                  if (chmodErr) {
                    const relativePath = path.relative(process.cwd(), file.path);
                    logger.error(
                      `Error setting executable permission on ${styles.bold(relativePath)}`,
                    );
                    logger.error(String(chmodErr));
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
  }

  async function processGenerator(gen: AnyCodeGenerator): Promise<void> {
    generatorResults[gen.id] = {
      tailordbResults: {},
      resolverResults: {},
      tailordbNamespaceResults: {},
      resolverNamespaceResults: {},
      executorResults: {},
    };

    // Process TailorDB if generator has tailordb dependency
    if (hasDependency(gen, "tailordb")) {
      for (const [namespace, types] of Object.entries(services.tailordb)) {
        await processTailorDBNamespace(gen, namespace, types);
      }
    }

    // Process Resolver if generator has resolver dependency
    if (hasDependency(gen, "resolver")) {
      for (const [namespace, resolvers] of Object.entries(services.resolver)) {
        await processResolverNamespace(gen, namespace, resolvers);
      }
    }

    // Process Executors if generator has executor dependency
    if (hasDependency(gen, "executor")) {
      await processExecutors(gen);
    }

    // Aggregate all results
    await aggregate(gen);
  }

  async function runGenerators(gens: Generator[], watch: boolean): Promise<void> {
    await Promise.allSettled(
      gens.map(async (gen) => {
        try {
          await processGenerator(gen as AnyCodeGenerator);
        } catch (error) {
          logger.error(`Error processing generator ${styles.bold(gen.id)}`);
          logger.error(String(error));
          if (!watch) {
            throw error;
          }
        }
      }),
    );
  }

  async function restartWatchProcess(): Promise<void> {
    logger.newline();
    logger.info("Restarting watch process to clear module cache...", {
      mode: "stream",
    });
    logger.newline();

    // Clean up watcher first
    if (watcher) {
      await watcher.stop();
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

  return {
    application,
    baseDir,
    generators,
    services,
    generatorResults,
    processGenerator,
    processTailorDBNamespace,
    processResolverNamespace,
    processExecutors,
    aggregate,

    async generate(watch: boolean): Promise<void> {
      logger.newline();
      logger.log(`Generation for application: ${styles.highlight(application.config.name)}`);

      const app = application;

      // Phase 1: Load TailorDB
      for (const db of app.tailorDBServices) {
        const namespace = db.namespace;
        try {
          await db.loadTypes();
          services.tailordb[namespace] = {
            types: db.getTypes(),
            sourceInfo: db.getTypeSourceInfo(),
          };
        } catch (error) {
          logger.error(`Error loading types for TailorDB service ${styles.bold(namespace)}`);
          logger.error(String(error));
          if (!watch) {
            throw error;
          }
        }
      }

      // Phase 2: Auth resolveNamespaces (depends on TailorDB)
      if (app.authService) {
        await app.authService.resolveNamespaces();
      }

      // Add blank line after TailorDB types loaded
      if (app.tailorDBServices.length > 0) {
        logger.newline();
      }

      // Phase 3: Run TailorDB-only generators
      const tailordbOnlyGens = generators.filter((g) => onlyHas(g as AnyCodeGenerator, "tailordb"));
      if (tailordbOnlyGens.length > 0) {
        await runGenerators(tailordbOnlyGens, watch);
        logger.newline();
      }

      // Phase 4: Load Resolvers (can now import generated files)
      for (const resolverService of app.resolverServices) {
        const namespace = resolverService.namespace;
        try {
          await resolverService.loadResolvers();
          services.resolver[namespace] = {};
          Object.entries(resolverService.getResolvers()).forEach(([_, resolver]) => {
            services.resolver[namespace][resolver.name] = resolver;
          });
        } catch (error) {
          logger.error(`Error loading resolvers for Resolver service ${styles.bold(namespace)}`);
          logger.error(String(error));
          if (!watch) {
            throw error;
          }
        }
      }

      // Phase 5: Run non-executor generators (resolver-dependent but not executor-dependent)
      const nonExecutorGens = generators.filter(
        (g) => !tailordbOnlyGens.includes(g) && hasNone(g as AnyCodeGenerator, "executor"),
      );
      if (nonExecutorGens.length > 0) {
        await runGenerators(nonExecutorGens, watch);
        logger.newline();
      }

      // Phase 6: Load Executors (can now import generated files)
      const executors = await application.executorService?.loadExecutors();
      Object.entries(executors ?? {}).forEach(([filePath, executor]) => {
        services.executor[filePath] = executor as Executor;
      });

      // Phase 7: Run executor-dependent generators
      const executorGens = generators.filter((g) => hasAll(g as AnyCodeGenerator, "executor"));
      if (executorGens.length > 0) {
        await runGenerators(executorGens, watch);
        logger.newline();
      }
    },

    async watch(): Promise<void> {
      watcher = createDependencyWatcher();

      // Set up restart callback
      watcher.setRestartCallback(() => {
        restartWatchProcess();
      });

      // Watch config file if available
      if (configPath) {
        await watcher.addWatchGroup("Config", [configPath]);
      }

      // Watch application services
      const app = application;

      // Watch TailorDB services
      for (const db of app.tailorDBServices) {
        const dbNamespace = db.namespace;
        await watcher?.addWatchGroup(`TailorDB/${dbNamespace}`, db.config.files);
      }

      // Watch Resolver services
      for (const resolverService of app.resolverServices) {
        const resolverNamespace = resolverService.namespace;
        await watcher?.addWatchGroup(
          `Resolver/${resolverNamespace}`,
          resolverService["config"].files,
        );
      }

      // Keep the process running
      await new Promise(() => {});
    },
  } as GenerationManager;
}

/**
 * Run code generation using the Tailor configuration and generators.
 * @param options - Generation options
 * @returns Promise that resolves when generation (and watch, if enabled) completes
 */
export async function generate(options?: GenerateOptions) {
  // Load and validate options
  const { config, generators, configPath } = await loadConfig(options?.configPath);
  const watch = options?.watch ?? false;

  // Generate user types from loaded config
  await generateUserTypes(config, configPath);
  const manager = createGenerationManager(config, generators, configPath);
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
      alias: "W",
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
