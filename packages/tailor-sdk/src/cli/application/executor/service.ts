import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { type ExecutorServiceConfig } from "@/configure/services/executor/types";
import { type Executor, ExecutorSchema } from "@/parser/service/executor";

export class ExecutorService {
  private executors: Record<string, Executor> = {};

  constructor(public readonly config: ExecutorServiceConfig) {}

  async loadExecutors() {
    if (!this.config.files || this.config.files.length === 0) {
      return;
    }

    const executorFiles: string[] = [];
    for (const pattern of this.config.files) {
      const absolutePattern = path.resolve(process.cwd(), pattern);
      try {
        const matchedFiles = fs.globSync(absolutePattern);
        executorFiles.push(...matchedFiles);
      } catch (error) {
        console.warn(`Failed to glob pattern "${pattern}":`, error);
      }
    }

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
        this.executors[executorFile] = result.data;
      }
    } catch (error) {
      console.error(`Failed to load executor from ${executorFile}:`, error);
      throw error;
    }
    return this.executors[executorFile];
  }

  getExecutors() {
    return this.executors;
  }
}
