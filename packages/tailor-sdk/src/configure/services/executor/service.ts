import * as fs from "node:fs";
import * as path from "node:path";
import { type Executor, type ExecutorServiceConfig } from "./types";
import { pathToFileURL } from "node:url";

export class ExecutorService {
  private isValidExecutor(executor: any): executor is Executor {
    return (
      executor &&
      typeof executor === "object" &&
      typeof executor.name === "string" &&
      executor.name.trim() !== "" &&
      (executor.description === undefined ||
        typeof executor.description === "string") &&
      executor.trigger &&
      typeof executor.trigger === "object" &&
      executor.exec &&
      typeof executor.exec === "object"
    );
  }
  private executors: Record<string, Executor> = {};

  constructor(public readonly config: ExecutorServiceConfig) {}

  getExecutors() {
    return this.executors;
  }

  async loadExecutors() {
    if (!this.config.files || this.config.files.length === 0) {
      return;
    }

    const typeFiles: string[] = [];
    for (const pattern of this.config.files) {
      const absolutePattern = path.resolve(process.cwd(), pattern);
      try {
        const matchedFiles = fs.globSync(absolutePattern);
        typeFiles.push(...matchedFiles);
      } catch (error) {
        console.warn(`Failed to glob pattern "${pattern}":`, error);
      }
    }

    for (const typeFile of typeFiles) {
      await this.loadExecutorForFile(typeFile);
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

      const module = await import(moduleSpecifier);

      const executor = module.default;
      if (this.isValidExecutor(executor)) {
        this.executors[executorFile] = executor;
      }
    } catch (error) {
      console.error(`Failed to load type from ${executorFile}:`, error);
      throw error;
    }
    return this.executors[executorFile];
  }
}
