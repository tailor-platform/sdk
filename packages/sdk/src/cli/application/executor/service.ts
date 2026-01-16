import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
import { type ExecutorServiceConfig } from "@/configure/services/executor/types";
import { type Executor, ExecutorSchema } from "@/parser/service/executor";

export class ExecutorService {
  private executors: Record<string, Executor> = {};

  constructor(public readonly config: ExecutorServiceConfig) {}

  async loadExecutors() {
    if (Object.keys(this.executors).length > 0) {
      return this.executors;
    }
    if (!this.config.files || this.config.files.length === 0) {
      return;
    }

    const executorFiles = loadFilesWithIgnores(this.config);

    logger.newline();
    logger.log(`Found ${styles.highlight(executorFiles.length.toString())} executor files`);

    await Promise.all(executorFiles.map((executorFile) => this.loadExecutorForFile(executorFile)));
    return this.executors;
  }

  async loadExecutorForFile(executorFile: string) {
    try {
      const executorModule = await import(pathToFileURL(executorFile).href);
      const result = ExecutorSchema.safeParse(executorModule.default);
      if (result.success) {
        const relativePath = path.relative(process.cwd(), executorFile);
        logger.log(
          `Executor: ${styles.successBright(`"${result.data.name}"`)} loaded from ${styles.path(relativePath)}`,
        );
        this.executors[executorFile] = result.data;
        return result.data;
      }
    } catch (error) {
      const relativePath = path.relative(process.cwd(), executorFile);
      logger.error(`Failed to load executor from ${styles.bold(relativePath)}`);
      logger.error(String(error));
      throw error;
    }
    return undefined;
  }

  getExecutors() {
    return this.executors;
  }
}
