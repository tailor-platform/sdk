import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "#/cli/services/file-loader";
import { logger, styles } from "#/cli/shared/logger";
import { ExecutorSchema } from "#/parser/service/executor/index";
import { isSdkBranded } from "#/utils/brand";
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
  /** Source type name (for type-attached executors) */
  sourceTypeName?: string;
}

export type ExecutorService = {
  readonly config: ExecutorServiceConfig;
  readonly executors: Record<string, Executor>;
  readonly pluginExecutors: ReadonlyArray<PluginExecutor>;
  loadExecutors: () => Promise<Record<string, Executor> | undefined>;
  loadPluginExecutorFiles: (filePaths: string[]) => Promise<void>;
};

/**
 * Parameters for creating an ExecutorService
 */
export interface CreateExecutorServiceParams {
  /** The executor service configuration */
  config: ExecutorServiceConfig;
}

/**
 * Creates a new ExecutorService instance.
 * @param params - Parameters for creating the service
 * @returns A new ExecutorService instance
 */
export function createExecutorService(params: CreateExecutorServiceParams): ExecutorService {
  const { config } = params;
  const executors: Record<string, Executor> = {};
  const pluginExecutors: PluginExecutor[] = [];
  let loadPromise: Promise<Record<string, Executor> | undefined> | undefined;

  const loadExecutorForFile = async (executorFile: string): Promise<Executor | undefined> => {
    try {
      const executorModule = await import(pathToFileURL(executorFile).href);
      const result = ExecutorSchema.safeParse(executorModule.default);
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

          const executorFiles = loadFilesWithIgnores(config);

          logger.newline();
          logger.log(`Found ${styles.highlight(executorFiles.length.toString())} executor files`);

          await Promise.all(executorFiles.map((executorFile) => loadExecutorForFile(executorFile)));
          return executors;
        })();
      }
      return loadPromise;
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
          // File path format: .tailor-sdk/plugin/{executor-name}.ts
          pluginExecutors.push({
            executor,
            pluginId: "plugin-generated",
            sourceTypeName: undefined,
          });
        }
      }
    },
  };
}
