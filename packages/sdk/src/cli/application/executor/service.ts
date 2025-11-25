import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { styleText } from "node:util";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
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

    console.log("");
    console.log(
      "Found",
      styleText("cyanBright", executorFiles.length.toString()),
      "executor files",
    );

    for (const executorFile of executorFiles) {
      await this.loadExecutorForFile(executorFile);
    }
    return this.executors;
  }

  async loadExecutorForFile(executorFile: string, timestamp?: Date) {
    try {
      const baseUrl = pathToFileURL(executorFile).href;
      const moduleSpecifier =
        timestamp === undefined
          ? baseUrl
          : `${baseUrl}?t=${timestamp.getTime()}`;

      const executorModule = await import(moduleSpecifier);
      const result = ExecutorSchema.safeParse(executorModule.default);
      if (result.success) {
        const relativePath = path.relative(process.cwd(), executorFile);
        console.log(
          "Executor:",
          styleText("greenBright", `"${result.data.name}"`),
          "loaded from",
          styleText("cyan", relativePath),
        );
        this.executors[executorFile] = result.data;
      }
    } catch (error) {
      const relativePath = path.relative(process.cwd(), executorFile);
      console.error(
        styleText("red", "Failed to load executor from"),
        styleText("redBright", relativePath),
      );
      console.error(error);
      throw error;
    }
    return this.executors[executorFile];
  }

  getExecutors() {
    return this.executors;
  }
}
