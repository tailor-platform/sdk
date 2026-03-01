import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "pathe";
import { defineCommand, arg } from "politty";
import { z } from "zod";
import {
  defineApplication,
  generatePluginFilesIfNeeded,
  type Application,
} from "@/cli/application";
import { createExecutorService } from "@/cli/application/executor/service";
import { loadConfig, type LoadedConfig, type Generator } from "@/cli/config-loader";
import {
  type AnyCodeGenerator,
  type TailorDBNamespaceResult,
  type ResolverNamespaceResult,
  type GeneratorAuthInput,
  type GeneratorResult,
  type DependencyKind,
  hasDependency,
} from "@/cli/generator/types";
import { generateUserTypes } from "@/cli/type-generator";
import { getDistDir } from "@/cli/utils/dist-dir";
import { logger, styles } from "@/cli/utils/logger";
import {
  type TailorDBNamespaceData,
  type ResolverNamespaceData,
} from "@/parser/plugin-config/generation-types";
import { type Executor } from "@/parser/service/executor";
import { type Resolver } from "@/parser/service/resolver";
import { PluginManager } from "@/plugin/manager";
import { commonArgs, configArg, withCommonArgs } from "../args";
import { createDependencyWatcher, type DependencyWatcher } from "./watch";
import type { GenerateOptions } from "./options";
import type { Plugin, PluginAttachment } from "@/parser/plugin-config/types";
import type { TailorDBType, TypeSourceInfo } from "@/parser/service/tailordb/types";

export type { CodeGenerator } from "@/cli/generator/types";

type TypeInfo = {
  types: Record<string, TailorDBType>;
  sourceInfo: TypeSourceInfo;
  pluginAttachments: ReadonlyMap<string, readonly PluginAttachment[]>;
};

/**
 * Generation manager type.
 */
export type GenerationManager = {
  readonly application: Application;
  readonly baseDir: string;
  readonly generators: Generator[];
  readonly services: {
    tailordb: Record<string, TypeInfo>;
    resolver: Record<string, Record<string, Resolver>>;
    executor: Record<string, Executor>;
  };
  readonly generatorResults: GeneratorResults;
  processGenerator: (gen: AnyCodeGenerator) => Promise<void>;
  processTailorDBNamespace: (
    gen: AnyCodeGenerator,
    namespace: string,
    typeInfo: TypeInfo,
  ) => Promise<void>;
  processResolverNamespace: (
    gen: AnyCodeGenerator,
    namespace: string,
    resolvers: Record<string, Resolver>,
  ) => Promise<void>;
  processExecutors: (gen: AnyCodeGenerator) => Promise<void>;
  aggregate: (gen: AnyCodeGenerator) => Promise<void>;
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
 * @param params - Parameters for creating the generation manager
 * @param params.application - Application instance to generate code for
 * @param params.config - Loaded configuration
 * @param params.generators - Code generators to run
 * @param params.pluginManager - Plugin manager for processing plugins
 * @returns GenerationManager instance
 */
export function createGenerationManager(params: {
  application: Application;
  config: LoadedConfig;
  generators?: Generator[];
  pluginManager?: PluginManager;
}): GenerationManager {
  const { application, config, generators = [], pluginManager } = params;
  const baseDir = path.join(getDistDir(), "generated");
  fs.mkdirSync(baseDir, { recursive: true });

  const services: {
    tailordb: Record<string, TypeInfo>;
    resolver: Record<string, Record<string, Resolver>>;
    executor: Record<string, Executor>;
  } = { tailordb: {}, resolver: {}, executor: {} };

  let watcher: DependencyWatcher | null = null;
  const generatorResults: GeneratorResults = {};

  // Get plugins that have generation hooks
  const generationPlugins = pluginManager?.getPluginsWithGenerationHooks() ?? [];

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

  // =========================================================================
  // Generator processing (unchanged - per-type/perNS/aggregate pipeline)
  // =========================================================================

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
            plugins: typeInfo.pluginAttachments.get(typeName) ?? [],
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
      configPath: config.path,
    });

    // Write generated files
    await writeGeneratedFiles(gen.id, result);
  }

  // =========================================================================
  // Plugin phase-complete hook runner
  // =========================================================================

  /**
   * Build TailorDB namespace data array from loaded services.
   * @returns Array of TailorDB namespace data
   */
  function buildTailorDBData(): TailorDBNamespaceData[] {
    return Object.entries(services.tailordb).map(([namespace, info]) => ({
      namespace,
      types: info.types,
      sourceInfo: new Map(Object.entries(info.sourceInfo)),
      pluginAttachments: info.pluginAttachments,
    }));
  }

  /**
   * Build resolver namespace data array from loaded services.
   * @returns Array of resolver namespace data
   */
  function buildResolverData(): ResolverNamespaceData[] {
    return Object.entries(services.resolver).map(([namespace, resolvers]) => ({
      namespace,
      resolvers,
    }));
  }

  /**
   * Run a plugin's phase-complete hook and write any generated files.
   * @param plugin - Plugin to run the hook on
   * @param hookName - Name of the hook to call
   * @returns Promise that resolves when hook completes
   */
  async function runPluginPhaseHook(
    plugin: Plugin,
    hookName: "onTailorDBReady" | "onResolverReady" | "onExecutorReady",
  ): Promise<void> {
    const hook = plugin[hookName];
    if (!hook) return;

    const pluginBaseDir = path.join(baseDir, plugin.id);
    const auth = getAuthInput();
    const tailordb = buildTailorDBData();

    let result: GeneratorResult;

    switch (hookName) {
      case "onTailorDBReady":
        result = await plugin.onTailorDBReady!({
          tailordb,
          auth,
          baseDir: pluginBaseDir,
          configPath: config.path,
          pluginConfig: plugin.pluginConfig,
        });
        break;
      case "onResolverReady":
        result = await plugin.onResolverReady!({
          tailordb,
          resolvers: buildResolverData(),
          auth,
          baseDir: pluginBaseDir,
          configPath: config.path,
          pluginConfig: plugin.pluginConfig,
        });
        break;
      case "onExecutorReady":
        result = await plugin.onExecutorReady!({
          tailordb,
          resolvers: buildResolverData(),
          executors: { ...services.executor },
          auth,
          baseDir: pluginBaseDir,
          configPath: config.path,
          pluginConfig: plugin.pluginConfig,
        });
        break;
    }

    await writeGeneratedFiles(plugin.id, result);
  }

  /**
   * Run a specific generation-time hook for all plugins that implement it.
   * Each hook runs at its natural pipeline phase, ensuring outputs from earlier
   * phases are available when later phases load resolvers/executors.
   * @param hookName - Name of the hook to call
   * @param watch - Whether running in watch mode (suppresses throws)
   */
  async function runPluginHook(
    hookName: "onTailorDBReady" | "onResolverReady" | "onExecutorReady",
    watch: boolean,
  ): Promise<void> {
    const plugins = generationPlugins.filter((p) => p[hookName] != null);
    if (plugins.length === 0) return;
    const results = await Promise.allSettled(
      plugins.map(async (plugin) => {
        try {
          await runPluginPhaseHook(plugin, hookName);
        } catch (error) {
          logger.error(`Error processing plugin ${styles.bold(plugin.id)} (${hookName})`);
          logger.error(String(error));
          if (!watch) {
            throw error;
          }
        }
      }),
    );
    if (!watch) {
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failures.length > 0) {
        throw new AggregateError(failures.map((f) => f.reason));
      }
    }
  }

  // =========================================================================
  // Shared file writing
  // =========================================================================

  /**
   * Write generated files to disk.
   * @param sourceId - Generator or plugin ID for logging
   * @param result - Generator result containing files to write
   */
  async function writeGeneratedFiles(sourceId: string, result: GeneratorResult): Promise<void> {
    await Promise.all(
      result.files.map(async (file) => {
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        return new Promise<void>((resolve, reject) => {
          if (file.skipIfExists && fs.existsSync(file.path)) {
            const relativePath = path.relative(process.cwd(), file.path);
            logger.debug(`${sourceId} | skip existing: ${relativePath}`);
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
              logger.log(`${sourceId} | generate: ${styles.success(relativePath)}`);
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

  // =========================================================================
  // Generator orchestration
  // =========================================================================

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
    const results = await Promise.allSettled(
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
    if (!watch) {
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failures.length > 0) {
        throw new AggregateError(failures.map((f) => f.reason));
      }
    }
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

      // Load TailorDB types (includes plugin-generated types)
      for (const db of app.tailorDBServices) {
        const namespace = db.namespace;

        try {
          await db.loadTypes();

          // Process namespace plugins after loading types
          // These plugins generate types without requiring a source type
          await db.processNamespacePlugins();

          services.tailordb[namespace] = {
            types: db.types,
            sourceInfo: db.typeSourceInfo,
            pluginAttachments: db.pluginAttachments,
          };
        } catch (error) {
          logger.error(`Error loading types for TailorDB service ${styles.bold(namespace)}`);
          logger.error(String(error));
          if (!watch) {
            throw error;
          }
        }
      }

      // Generate plugin type and executor files
      // This must happen after TailorDB types are loaded since plugins process during type loading
      const pluginExecutorFiles = generatePluginFilesIfNeeded(
        pluginManager,
        app.tailorDBServices,
        config.path,
      );
      const executorService =
        app.executorService ??
        (pluginExecutorFiles.length > 0
          ? createExecutorService({ config: { files: [] } })
          : undefined);

      // Resolve Auth namespaces (depends on TailorDB)
      if (app.authService) {
        await app.authService.resolveNamespaces();
      }

      // Add blank line after TailorDB types loaded
      if (app.tailorDBServices.length > 0 || pluginExecutorFiles.length > 0) {
        logger.newline();
      }

      // Run TailorDB-only generators and onTailorDBReady for all plugins
      const tailordbOnlyGens = generators.filter((g) => onlyHas(g as AnyCodeGenerator, "tailordb"));
      const hasOnTailorDBReady = generationPlugins.some((p) => p.onTailorDBReady != null);
      if (tailordbOnlyGens.length > 0 || hasOnTailorDBReady) {
        await Promise.all([
          runGenerators(tailordbOnlyGens, watch),
          runPluginHook("onTailorDBReady", watch),
        ]);
        logger.newline();
      }

      // Load Resolvers (can now import generated files)
      for (const resolverService of app.resolverServices) {
        const namespace = resolverService.namespace;
        try {
          await resolverService.loadResolvers();
          services.resolver[namespace] = {};
          Object.entries(resolverService.resolvers).forEach(([_, resolver]) => {
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

      // Run non-executor generators and onResolverReady for all plugins
      const nonExecutorGens = generators.filter(
        (g) => !tailordbOnlyGens.includes(g) && hasNone(g as AnyCodeGenerator, "executor"),
      );
      const hasOnResolverReady = generationPlugins.some((p) => p.onResolverReady != null);
      if (nonExecutorGens.length > 0 || hasOnResolverReady) {
        await Promise.all([
          runGenerators(nonExecutorGens, watch),
          runPluginHook("onResolverReady", watch),
        ]);
        logger.newline();
      }

      // Load Executors (can now import generated files)
      if (executorService) {
        await executorService.loadExecutors();
        // Load plugin-generated executors from generated TypeScript files
        if (pluginExecutorFiles.length > 0) {
          await executorService.loadPluginExecutorFiles([...pluginExecutorFiles]);
        }
      }
      // Get all executors (file-based and plugin-generated)
      const allExecutors = executorService?.executors ?? {};
      Object.entries(allExecutors).forEach(([key, executor]) => {
        services.executor[key] = executor as Executor;
      });

      // Run executor-dependent generators and onExecutorReady for all plugins
      const executorGens = generators.filter((g) => hasAll(g as AnyCodeGenerator, "executor"));
      const hasOnExecutorReady = generationPlugins.some((p) => p.onExecutorReady != null);
      if (executorGens.length > 0 || hasOnExecutorReady) {
        await Promise.all([
          runGenerators(executorGens, watch),
          runPluginHook("onExecutorReady", watch),
        ]);
        logger.newline();
      }
    },

    async watch(): Promise<void> {
      watcher = createDependencyWatcher();

      // Set up restart callback
      watcher.setRestartCallback(() => {
        restartWatchProcess();
      });

      // Watch config file
      await watcher.addWatchGroup("Config", [config.path]);

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
  };
}

/**
 * Run code generation using the Tailor configuration and generators.
 * @param options - Generation options
 * @returns Promise that resolves when generation (and watch, if enabled) completes
 */
export async function generate(options?: GenerateOptions) {
  // Load and validate options
  const { config, generators, plugins } = await loadConfig(options?.configPath);
  const watch = options?.watch ?? false;

  // Generate user types from loaded config
  await generateUserTypes({ config, configPath: config.path });

  // Initialize plugin manager if plugins are provided
  let pluginManager: PluginManager | undefined;
  if (plugins.length > 0) {
    pluginManager = new PluginManager(plugins);
  }

  // Create a lightweight application (types not yet loaded)
  const application = defineApplication({ config, pluginManager });
  const manager = createGenerationManager({ application, config, generators, pluginManager });
  await manager.generate(watch);
  if (watch) {
    await manager.watch();
  }
}

export const generateCommand = defineCommand({
  name: "generate",
  description: "Generate files using Tailor configuration.",
  args: z.object({
    ...commonArgs,
    ...configArg,
    watch: arg(z.boolean().default(false), {
      alias: "W",
      description: "Watch for type/resolver changes and regenerate",
    }),
  }),
  run: withCommonArgs(async (args) => {
    await generate({
      configPath: args.config,
      watch: args.watch,
    });
  }),
});
