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
import { PluginManager, type AggregatedPluginOutput } from "@/cli/plugin/manager";
import { generateUserTypes, generatePluginTypes } from "@/cli/type-generator";
import { logger, styles } from "@/cli/utils/logger";
import { getDistDir, type AppConfig } from "@/configure/config";
import { type Generator } from "@/parser/generator-config";
import { type Executor } from "@/parser/service/executor";
import { type Resolver } from "@/parser/service/resolver";
import { commonArgs, withCommonArgs } from "../args";
import { DependencyWatcher } from "./watch";
import type { GenerateOptions } from "./options";
import type { Plugin } from "@/parser/plugin-config";
import type { PluginBase } from "@/parser/plugin-config/types";
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
  private pluginManager?: PluginManager;
  private pluginOutput?: AggregatedPluginOutput;

  constructor(
    config: AppConfig,
    private generators: Generator[] = [],
    private plugins: Plugin[] = [],
    private configPath?: string,
  ) {
    this.application = defineApplication(config);
    this.baseDir = path.join(getDistDir(), "generated");
    fs.mkdirSync(this.baseDir, { recursive: true });

    // Initialize plugin manager if plugins are provided
    if (plugins.length > 0) {
      // Cast Plugin (branded type) to PluginBase for the manager
      this.pluginManager = new PluginManager(plugins as unknown as PluginBase[]);
    }
  }

  // Helper functions for dependency checking
  private getDeps(gen: AnyCodeGenerator): Set<DependencyKind> {
    return new Set(gen.dependencies);
  }

  private onlyHas(gen: AnyCodeGenerator, ...required: DependencyKind[]): boolean {
    const deps = this.getDeps(gen);
    return required.every((r) => deps.has(r)) && deps.size === required.length;
  }

  private hasAll(gen: AnyCodeGenerator, ...required: DependencyKind[]): boolean {
    return required.every((r) => this.getDeps(gen).has(r));
  }

  private hasNone(gen: AnyCodeGenerator, ...excluded: DependencyKind[]): boolean {
    return excluded.every((e) => !this.getDeps(gen).has(e));
  }

  /**
   * Process all plugins and collect their outputs
   */
  private async processPlugins() {
    if (!this.pluginManager) return;

    const app = this.application;

    // Register type attachments from all TailorDB services
    for (const db of app.tailorDBServices) {
      const namespace = db.namespace;
      const types = db.getTypes();
      const attachments = db.getPluginAttachments();

      this.pluginManager.registerFromService(types, namespace, attachments);
    }

    // Process all registered attachments
    if (this.pluginManager.hasAttachments()) {
      this.pluginOutput = await this.pluginManager.processAll();

      // Log summary of generated artifacts
      // Note: In the PoC, we only log the output. Full integration (merging
      // generated types/resolvers/executors back into services) is future work.
    }
  }

  async generate(watch: boolean) {
    logger.newline();
    logger.log(`Generation for application: ${styles.highlight(this.application.config.name)}`);

    const app = this.application;

    // Phase 1: Load TailorDB
    for (const db of app.tailorDBServices) {
      const namespace = db.namespace;
      try {
        await db.loadTypes();
        this.services.tailordb[namespace] = {
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

    // Phase 1.5: Process plugins (depends on TailorDB)
    if (this.pluginManager) {
      await this.processPlugins();
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
    const tailordbOnlyGens = this.generators.filter((g) =>
      this.onlyHas(g as AnyCodeGenerator, "tailordb"),
    );
    if (tailordbOnlyGens.length > 0) {
      await this.runGenerators(tailordbOnlyGens, watch);
      logger.newline();
    }

    // Phase 4: Load Resolvers (can now import generated files)
    for (const resolverService of app.resolverServices) {
      const namespace = resolverService.namespace;
      try {
        await resolverService.loadResolvers();
        this.services.resolver[namespace] = {};
        Object.entries(resolverService.getResolvers()).forEach(([_, resolver]) => {
          this.services.resolver[namespace][resolver.name] = resolver;
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
    const nonExecutorGens = this.generators.filter(
      (g) => !tailordbOnlyGens.includes(g) && this.hasNone(g as AnyCodeGenerator, "executor"),
    );
    if (nonExecutorGens.length > 0) {
      await this.runGenerators(nonExecutorGens, watch);
      logger.newline();
    }

    // Phase 6: Load Executors (can now import generated files)
    const executors = await this.application.executorService?.loadExecutors();
    Object.entries(executors ?? {}).forEach(([filePath, executor]) => {
      this.services.executor[filePath] = executor as Executor;
    });

    // Phase 7: Run executor-dependent generators
    const executorGens = this.generators.filter((g) =>
      this.hasAll(g as AnyCodeGenerator, "executor"),
    );
    if (executorGens.length > 0) {
      await this.runGenerators(executorGens, watch);
      logger.newline();
    }
  }

  private async runGenerators(generators: Generator[], watch: boolean) {
    await Promise.allSettled(
      generators.map(async (gen) => {
        try {
          await this.processGenerator(gen as AnyCodeGenerator);
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

  // Store results for each generator, service type, and namespace
  private generatorResults: Record<
    /* generator */ string,
    {
      tailordbResults: Record</* namespace */ string, Record</* type */ string, unknown>>;
      resolverResults: Record</* namespace */ string, Record</* resolver */ string, unknown>>;
      tailordbNamespaceResults: Record</* namespace */ string, unknown>;
      resolverNamespaceResults: Record</* namespace */ string, unknown>;
      executorResults: Record</* executor */ string, unknown>;
    }
  > = {};

  async processGenerator(gen: AnyCodeGenerator) {
    this.generatorResults[gen.id] = {
      tailordbResults: {},
      resolverResults: {},
      tailordbNamespaceResults: {},
      resolverNamespaceResults: {},
      executorResults: {},
    };

    // Process TailorDB if generator has tailordb dependency
    if (hasDependency(gen, "tailordb")) {
      for (const [namespace, types] of Object.entries(this.services.tailordb)) {
        await this.processTailorDBNamespace(gen, namespace, types);
      }
    }

    // Process Resolver if generator has resolver dependency
    if (hasDependency(gen, "resolver")) {
      for (const [namespace, resolvers] of Object.entries(this.services.resolver)) {
        await this.processResolverNamespace(gen, namespace, resolvers);
      }
    }

    // Process Executors if generator has executor dependency
    if (hasDependency(gen, "executor")) {
      await this.processExecutors(gen);
    }

    // Aggregate all results
    await this.aggregate(gen);
  }

  async processTailorDBNamespace(gen: AnyCodeGenerator, namespace: string, typeInfo: TypeInfo) {
    const results = this.generatorResults[gen.id];
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

  async processResolverNamespace(
    gen: AnyCodeGenerator,
    namespace: string,
    resolvers: Record<string, Resolver>,
  ) {
    const results = this.generatorResults[gen.id];
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

  async processExecutors(gen: AnyCodeGenerator) {
    const results = this.generatorResults[gen.id];

    // Check if generator has processExecutor method
    if (!gen.processExecutor) {
      return;
    }

    const processExecutor = gen.processExecutor;
    // Process individual executors
    await Promise.allSettled(
      Object.entries(this.services.executor).map(async ([executorId, executor]) => {
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

  private getAuthInput(): GeneratorAuthInput | undefined {
    const authService = this.application.authService;
    if (!authService) return undefined;

    const config = authService.parsedConfig;
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

  async aggregate(gen: AnyCodeGenerator) {
    const results = this.generatorResults[gen.id];

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
      auth: this.getAuthInput(),
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
      baseDir: path.join(this.baseDir, gen.id),
      configPath: this.configPath ?? "tailor.config.ts",
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
      await this.watcher?.addWatchGroup(`TailorDB/${dbNamespace}`, db.config.files);
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
    logger.newline();
    logger.info("Restarting watch process to clear module cache...", {
      mode: "stream",
    });
    logger.newline();

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

/**
 * Run code generation using the Tailor configuration and generators.
 * @param options - Generation options
 * @returns Promise that resolves when generation (and watch, if enabled) completes
 */
export async function generate(options?: GenerateOptions) {
  // Load and validate options
  const { config, generators, plugins, configPath } = await loadConfig(options?.configPath);
  const watch = options?.watch ?? false;

  // Generate user types from loaded config
  await generateUserTypes(config, configPath);

  // Generate plugin types from loaded plugins
  const pluginIds = plugins.map((p) => p.id);
  await generatePluginTypes(pluginIds, configPath);

  const manager = new GenerationManager(config, generators, plugins, configPath);
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
