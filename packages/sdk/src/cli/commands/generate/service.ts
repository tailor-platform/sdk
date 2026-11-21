import * as fs from "node:fs";
import * as path from "pathe";
import {
  defineApplication,
  definePluginResolverServices,
  defineWorkspaceServices,
  generatePluginFilesIfNeeded,
  type ConfigServices,
} from "#/cli/services/application";
import { createExecutorService } from "#/cli/services/executor/service";
import {
  assertUniqueLocalTailorDBTypeNames,
  tailorDBTypeNameScopeOf,
} from "#/cli/services/tailordb/type-name-validation";
import { getAuthInput } from "#/cli/shared/auth-input";
import {
  isLoadedWorkspaceConfig,
  loadConfigFile,
  type LoadedConfig,
  type LoadedWorkspaceConfig,
} from "#/cli/shared/config-loader";
import { getDistDir } from "#/cli/shared/dist-dir";
import { errorToJson } from "#/cli/shared/error-json";
import { CLIError, isCLIError } from "#/cli/shared/errors";
import { logger, plainRedacted, styles } from "#/cli/shared/logger";
import { generateUserTypes, generateWorkspaceUserTypes } from "#/cli/shared/type-generator";
import { defineUnambiguousContextField } from "#/cli/shared/unambiguous-context-field";
import { withSpan } from "#/cli/telemetry/index";
import { PluginManager } from "#/plugin/manager";
import { assertDefined } from "#/utils/assert";
import type { TypeSourceInfo, TailorDBType } from "#/parser/service/tailordb/types";
import type {
  GeneratorResult,
  TailorDBNamespaceData,
  ResolverNamespaceData,
  Plugin,
  PluginAttachment,
} from "#/plugin/types";
import type { Executor } from "#/types/executor.generated";
import type { Resolver } from "#/types/resolver.generated";
import type { GenerateOptions } from "./options";

type TypeInfo = {
  types: Record<string, TailorDBType>;
  sourceInfo: TypeSourceInfo;
  pluginAttachments: ReadonlyMap<string, readonly PluginAttachment[]>;
};

/**
 * Generation manager type.
 */
export type GenerationManager = {
  readonly configServices: ConfigServices;
  readonly baseDir: string;
  readonly services: {
    tailordb: Record<string, TypeInfo>;
    resolver: Record<string, Record<string, Resolver>>;
    executor: Record<string, Executor>;
  };
  generate: () => Promise<void>;
};

function generationTarget(config: LoadedConfig | LoadedWorkspaceConfig): string {
  if (!isLoadedWorkspaceConfig(config)) {
    return `application: ${styles.highlight(config.name)}`;
  }
  const [appName] = Object.keys(config.apps);
  return config.definedBy === "defineApp" && appName !== undefined
    ? `application: ${styles.highlight(appName)}`
    : `workspace: ${styles.highlight(path.relative(process.cwd(), config.path))}`;
}

/**
 * Parameters for creating a generation manager
 */
export interface CreateGenerationManagerParams {
  /** Services the config defines */
  configServices: ConfigServices;
  /** The `defineConfig()` or workspace config the services come from */
  config: LoadedConfig | LoadedWorkspaceConfig;
  /** Plugin manager for processing plugins */
  pluginManager?: PluginManager;
}

/**
 * Creates a generation manager.
 * @param params - Parameters for creating the generation manager
 * @returns GenerationManager instance
 */
export function createGenerationManager(params: CreateGenerationManagerParams): GenerationManager {
  const { configServices, config, pluginManager } = params;
  const configPath = config.path;
  const configDir = path.dirname(configPath);
  const baseDir = path.resolve(getDistDir(), "generated");
  fs.mkdirSync(baseDir, { recursive: true });

  const services: {
    tailordb: Record<string, TypeInfo>;
    resolver: Record<string, Record<string, Resolver>>;
    executor: Record<string, Executor>;
  } = { tailordb: {}, resolver: {}, executor: {} };

  // Get plugins that have generation hooks
  const generationPlugins = pluginManager?.getPluginsWithGenerationHooks() ?? [];

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
      tables: info.types,
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
    const auths = Object.fromEntries(
      configServices.authServices.map((authService) => [
        authService.config.name,
        getAuthInput(authService),
      ]),
    );
    const withAuthField = <Context extends object>(context: Context) =>
      defineUnambiguousContextField(context, {
        key: "auth",
        candidates: auths,
        candidatesLabel: "Auth services",
        replacement: "auths",
      });
    const tailordb = buildTailorDBData();

    let result: GeneratorResult;

    switch (hookName) {
      case "onTailorDBReady":
        result = await assertDefined(
          plugin.onTailorDBReady,
          "plugin.onTailorDBReady hook missing",
        )(
          withAuthField({
            tailordb,
            auths,
            baseDir: pluginBaseDir,
            configPath,
            pluginConfig: plugin.pluginConfig,
          }),
        );
        break;
      case "onResolverReady":
        result = await assertDefined(
          plugin.onResolverReady,
          "plugin.onResolverReady hook missing",
        )(
          withAuthField({
            tailordb,
            resolvers: buildResolverData(),
            auths,
            baseDir: pluginBaseDir,
            configPath,
            pluginConfig: plugin.pluginConfig,
          }),
        );
        break;
      case "onExecutorReady":
        result = await assertDefined(
          plugin.onExecutorReady,
          "plugin.onExecutorReady hook missing",
        )(
          withAuthField({
            tailordb,
            resolvers: buildResolverData(),
            executors: { ...services.executor },
            auths,
            baseDir: pluginBaseDir,
            configPath,
            pluginConfig: plugin.pluginConfig,
          }),
        );
        break;
    }

    await writeGeneratedFiles(plugin.id, result);
  }

  /**
   * Run a specific generation-time hook for all plugins that implement it.
   * Each hook runs at its natural pipeline phase, ensuring outputs from earlier
   * phases are available when later phases load resolvers/executors.
   * @param hookName - Name of the hook to call
   */
  async function runPluginHook(
    hookName: "onTailorDBReady" | "onResolverReady" | "onExecutorReady",
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
          throw error;
        }
      }),
    );
    const failures = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            {
              plugin: assertDefined(plugins[index], "Plugin result has no matching plugin").id,
              reason: result.reason as unknown,
            },
          ]
        : [],
    );
    if (failures.length > 0) {
      throw CLIError({
        code: "PLUGIN_GENERATION_FAILED",
        message: `Plugin generation failed during ${hookName}.`,
        details: failures
          .map(
            ({ plugin, reason }) =>
              `${plugin}: ${isCLIError(reason) ? plainRedacted(reason.format()) : String(reason)}`,
          )
          .join("\n"),
        context: {
          hook: hookName,
          failures: failures.map(({ plugin, reason }) => ({
            plugin,
            error: errorToJson(reason, { includeStack: logger.verbose }).error,
          })),
        },
      });
    }
  }

  // =========================================================================
  // Shared file writing
  // =========================================================================

  /**
   * Write generated files to disk.
   * @param sourceId - Plugin ID for logging
   * @param result - Generation result containing files to write
   */
  async function writeGeneratedFiles(sourceId: string, result: GeneratorResult): Promise<void> {
    await Promise.all(
      result.files.map(async (file) => {
        const filePath = path.resolve(configDir, file.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        return new Promise<void>((resolve, reject) => {
          const relativePath = path.relative(process.cwd(), filePath);
          if (file.skipIfExists && fs.existsSync(filePath)) {
            logger.debug(`${sourceId} | skip existing: ${relativePath}`);
            return resolve();
          }

          fs.writeFile(filePath, file.content, (err) => {
            if (err) {
              logger.error(`Error writing file ${styles.bold(relativePath)}`);
              reject(err);
            } else {
              logger.debug(`${sourceId} | generate: ${styles.success(relativePath)}`);
              resolve();
            }
          });
        });
      }),
    );
    if (result.files.length > 0) {
      logger.log(`${sourceId} | generation complete`);
    }
  }

  return {
    configServices,
    baseDir,
    services,

    async generate(): Promise<void> {
      logger.newline();
      logger.log(`Generation for ${generationTarget(config)}`);

      // Load TailorDB tables (includes plugin-generated tables)
      await withSpan("generate.loadTailorDBTypes", async (span) => {
        span.setAttribute("generate.namespace_count", configServices.tailorDBServices.length);
        for (const db of configServices.tailorDBServices) {
          const namespace = db.namespace;
          await withSpan(`generate.loadTypes.${namespace}`, async () => {
            try {
              await db.loadTypes();

              // Process namespace plugins after loading tables
              // These plugins generate tables without requiring a source table
              await db.processNamespacePlugins();

              services.tailordb[namespace] = {
                types: db.types,
                sourceInfo: db.typeSourceInfo,
                pluginAttachments: db.pluginAttachments,
              };
            } catch (error) {
              logger.error(`Error loading tables for TailorDB service ${styles.bold(namespace)}`);
              throw error;
            }
          });
        }
        try {
          assertUniqueLocalTailorDBTypeNames({
            tailorDBServices: configServices.tailorDBServices,
            scope: tailorDBTypeNameScopeOf(config),
          });
        } catch (error) {
          logger.error("Error validating TailorDB table names");
          throw error;
        }
      });
      const resolverServices = [
        ...configServices.resolverServices,
        ...definePluginResolverServices(config, pluginManager),
      ];

      // Generate plugin type and executor files
      // This must happen after TailorDB tables are loaded since plugins process during table loading
      const { pluginExecutorFiles, executorService } = await withSpan(
        "generate.pluginFiles",
        async () => {
          const pluginExecutorFiles = generatePluginFilesIfNeeded(
            pluginManager,
            configServices.tailorDBServices,
            configPath,
          );
          const executorService =
            configServices.executorService ??
            (pluginExecutorFiles.length > 0
              ? createExecutorService({ config: { files: [] }, baseDir: configDir })
              : undefined);
          return { pluginExecutorFiles, executorService };
        },
      );

      // Resolve Auth namespaces (depends on TailorDB)
      if (configServices.authServices.length > 0) {
        await withSpan("generate.resolveAuthNamespaces", async () => {
          for (const authService of configServices.authServices) {
            await authService.resolveNamespaces();
          }
        });
      }

      // Add blank line after TailorDB tables loaded
      if (configServices.tailorDBServices.length > 0 || pluginExecutorFiles.length > 0) {
        logger.newline();
      }

      // Run plugin hooks for onTailorDBReady
      const hasOnTailorDBReady = generationPlugins.some((p) => p.onTailorDBReady != null);
      if (hasOnTailorDBReady) {
        await withSpan("generate.onTailorDBReady", async () => {
          await runPluginHook("onTailorDBReady");
        });
        logger.newline();
      }

      // Load Resolvers (can now import generated files)
      await withSpan("generate.loadResolvers", async () => {
        for (const resolverService of resolverServices) {
          const namespace = resolverService.namespace;
          await withSpan(`generate.loadResolvers.${namespace}`, async () => {
            try {
              await resolverService.loadResolvers();
              const namespaceResolvers: Record<string, Resolver> = {};
              services.resolver[namespace] = namespaceResolvers;
              Object.entries(resolverService.resolvers).forEach(([_, resolver]) => {
                namespaceResolvers[resolver.name] = resolver;
              });
            } catch (error) {
              logger.error(
                `Error loading resolvers for Resolver service ${styles.bold(namespace)}`,
              );
              throw error;
            }
          });
        }
      });

      // Run plugin hooks for onResolverReady
      const hasOnResolverReady = generationPlugins.some((p) => p.onResolverReady != null);
      if (hasOnResolverReady) {
        await withSpan("generate.onResolversReady", async () => {
          await runPluginHook("onResolverReady");
        });
        logger.newline();
      }

      // Load Executors (can now import generated files)
      await withSpan("generate.loadExecutors", async () => {
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
          services.executor[key] = executor;
        });
      });

      // Run plugin hooks for onExecutorReady
      const hasOnExecutorReady = generationPlugins.some((p) => p.onExecutorReady != null);
      if (hasOnExecutorReady) {
        await withSpan("generate.onExecutorsReady", async () => {
          await runPluginHook("onExecutorReady");
        });
        logger.newline();
      }
    },
  };
}

/**
 * Run code generation using the Tailor configuration.
 * @param options - Generation options
 * @returns Promise that resolves when generation completes
 */
export async function generate(options?: GenerateOptions) {
  return withSpan("generate", async (rootSpan) => {
    const loaded = await withSpan("generate.loadConfig", async () => {
      return loadConfigFile(options?.configPath);
    });
    const pluginManager = loaded.plugins.length > 0 ? new PluginManager(loaded.plugins) : undefined;

    if (loaded.kind === "workspace") {
      const { workspace } = loaded;
      await withSpan("generate.generateUserTypes", async () =>
        generateWorkspaceUserTypes({ workspace }),
      );
      const configServices = defineWorkspaceServices({ workspace, pluginManager });
      await createGenerationManager({
        configServices,
        config: workspace,
        pluginManager,
      }).generate();
      return;
    }

    const { config } = loaded;
    await withSpan("generate.generateUserTypes", async () =>
      generateUserTypes({ config, configPath: config.path }),
    );

    // Create a lightweight application (tables not yet loaded)
    const application = defineApplication({ config, pluginManager });

    rootSpan.setAttribute("app.name", application.config.name);

    const manager = createGenerationManager({
      configServices: application,
      config,
      pluginManager,
    });
    await manager.generate();
  });
}
