import * as path from "pathe";
import { loadFilesWithIgnores } from "#/cli/services/file-loader";
import { logger, styles } from "#/cli/shared/logger";
import { importUserModule } from "#/cli/shared/user-modules";
import { ExecutorSchema } from "#/parser/service/executor/index";
import { isSdkBranded } from "#/utils/brand";
import { stripExecutorTriggerArgs } from "./loader";
import type { ExecutorServiceConfig } from "#/configure/config/types";
import type { Executor } from "#/types/executor.generated";

/**
 * Information about a plugin-generated executor converted to Executor format
 */
export interface PluginExecutor {
  /** The executor in standard Executor format */
  executor: Executor;
  /** Plugin ID that generated this executor */
  pluginId: string;
  /** Source table name (for table-attached executors) */
  sourceTableName?: string;
}

export type ExecutorService = {
  readonly config: ExecutorServiceConfig;
  readonly executors: Record<string, Executor>;
  readonly pluginExecutors: ReadonlyArray<PluginExecutor>;
  /**
   * Loads executor files once and resolves to the executor record loaded so
   * far. Resolves to undefined only when the config declares no files and no
   * plugin executor has been loaded yet; plugin executors appear in calls
   * made after loadPluginExecutorFiles() has completed.
   */
  loadExecutors: () => Promise<Record<string, Executor> | undefined>;
  loadPluginExecutorFiles: (filePaths: string[]) => Promise<void>;
};

/**
 * Parameters for creating an ExecutorService
 */
export interface CreateExecutorServiceParams {
  /** The executor service configuration */
  config: ExecutorServiceConfig;
  /** Directory the config's file patterns are resolved against */
  baseDir: string;
}

/**
 * Creates a new ExecutorService instance.
 * @param params - Parameters for creating the service
 * @returns A new ExecutorService instance
 */
export function createExecutorService(params: CreateExecutorServiceParams): ExecutorService {
  const { config, baseDir } = params;
  const executors: Record<string, Executor> = {};
  const pluginExecutors: PluginExecutor[] = [];
  let loadPromise: Promise<Record<string, Executor> | undefined> | undefined;

  const loadExecutorForFile = async (executorFile: string): Promise<Executor | undefined> => {
    try {
      const executorModule = await importUserModule(executorFile);
      const result = ExecutorSchema.safeParse(stripExecutorTriggerArgs(executorModule.default));
      if (result.success) {
        const relativePath = path.relative(process.cwd(), executorFile);
        logger.log(
          `Executor: ${styles.successBright(`"${result.data.name}"`)} loaded from ${styles.path(relativePath)}`,
        );
        executors[executorFile] = result.data;
        return result.data;
      }
      if (isSdkBranded(executorModule.default, "executor")) {
        throw result.error;
      }
    } catch (error) {
      const relativePath = path.relative(process.cwd(), executorFile);
      logger.error(`Failed to load executor from ${styles.bold(relativePath)}`);
      logger.error(String(error));
      throw error;
    }
    return undefined;
  };

  return {
    config,
    get executors() {
      return executors;
    },
    get pluginExecutors() {
      return pluginExecutors;
    },
    loadExecutors: async () => {
      if (!loadPromise) {
        loadPromise = (async () => {
          if (config.files.length === 0) {
            return undefined;
          }

          const executorFiles = loadFilesWithIgnores(config, baseDir);

          logger.newline();
          logger.log(`Found ${styles.highlight(executorFiles.length.toString())} executor files`);

          await Promise.all(executorFiles.map((executorFile) => loadExecutorForFile(executorFile)));
          assertUniqueExecutorNames(executors);
          return executors;
        })();
      }
      const loaded = await loadPromise;
      // Files are loaded only once, but plugin executors registered by
      // loadPluginExecutorFiles() after that first load must reach callers
      // that re-invoke loadExecutors(), such as deployment planning.
      return loaded ?? (Object.keys(executors).length > 0 ? executors : undefined);
    },
    loadPluginExecutorFiles: async (filePaths: string[]) => {
      if (filePaths.length === 0) return;

      logger.newline();
      logger.log(
        `Loading ${styles.highlight(filePaths.length.toString())} plugin-generated executor files`,
      );

      for (const filePath of filePaths) {
        const executor = await loadExecutorForFile(filePath);
        if (executor) {
          // Track as plugin executor (plugin ID is extracted from file path)
          // File path format: .tailor/plugin/{executor-name}.ts
          pluginExecutors.push({
            executor,
            pluginId: "plugin-generated",
            sourceTableName: undefined,
          });
        }
      }
      assertUniqueExecutorNames(executors);
    },
  };
}

/**
 * Assert that every loaded executor has a unique name.
 * Executors are stored by source file, so two files declaring the same
 * `name` would otherwise silently share a single bundle cache entry.
 * @param executors - Loaded executors keyed by source file
 */
function assertUniqueExecutorNames(executors: Record<string, Executor>): void {
  const seenNames = new Map<string, string>();
  for (const [file, executor] of Object.entries(executors)) {
    const relativePath = path.relative(process.cwd(), file);
    const existing = seenNames.get(executor.name);
    if (existing) {
      throw new Error(
        `Duplicate executor name "${executor.name}" found:\n` +
          `  - ${existing}\n` +
          `  - ${relativePath}\n` +
          `Each executor must have a unique name.`,
      );
    }
    seenNames.set(executor.name, relativePath);
  }
}
