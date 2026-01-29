import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
import {
  ExecutorSchema,
  type Executor,
  type ExecutorServiceConfig,
} from "@/parser/service/executor";

export type ExecutorService = {
  readonly config: ExecutorServiceConfig;
  getExecutors: () => Record<string, Executor>;
  loadExecutors: () => Promise<Record<string, Executor> | undefined>;
};

/**
 * Creates a new ExecutorService instance.
 * @param config - The executor service configuration
 * @returns A new ExecutorService instance
 */
export function createExecutorService(config: ExecutorServiceConfig): ExecutorService {
  const executors: Record<string, Executor> = {};

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
    getExecutors: () => executors,
    loadExecutors: async () => {
      if (Object.keys(executors).length > 0) {
        return executors;
      }
      if (!config.files || config.files.length === 0) {
        return;
      }

      const executorFiles = loadFilesWithIgnores(config);

      logger.newline();
      logger.log(`Found ${styles.highlight(executorFiles.length.toString())} executor files`);

      await Promise.all(executorFiles.map((executorFile) => loadExecutorForFile(executorFile)));
      return executors;
    },
  };
}
