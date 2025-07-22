import fs from "node:fs";
import path from "node:path";
import { measure } from "@/performance";
import { Executor, ExecutorServiceConfig } from "./types";
import { Bundler, BundlerConfig } from "@/bundler";
import { ExecutorLoader } from "./bundler/loader";
import { ExecutorTransformer } from "./bundler/transformer";

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
      executor.trigger.manifest &&
      typeof executor.trigger.manifest === "object" &&
      executor.trigger.context &&
      typeof executor.trigger.context === "object" &&
      executor.exec &&
      typeof executor.exec === "object" &&
      executor.exec.manifest &&
      typeof executor.exec.manifest === "object" &&
      executor.exec.context &&
      typeof executor.exec.context === "object"
    );
  }
  private executors: Record<string, Executor> = {};
  private bundler: Bundler<Executor>;

  constructor(
    public readonly namespace: string,
    public readonly config: ExecutorServiceConfig,
  ) {
    const bundlerConfig: BundlerConfig<Executor> = {
      namespace,
      serviceConfig: config,
      loader: new ExecutorLoader(),
      transformer: new ExecutorTransformer(),
      outputDirs: {
        preBundle: "executors",
        postBundle: "executors",
      },
      shouldProcess: (executor) => {
        return executor.exec.manifest.Kind === "function";
      },
    };
    this.bundler = new Bundler(bundlerConfig);
  }

  @measure
  async build() {
    await this.bundler.bundle();
  }

  @measure
  getExecutors() {
    return this.executors;
  }

  @measure
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
      const module = await import(
        [executorFile, ...(timestamp ? [timestamp.getTime()] : [])].join("?t=")
      );

      const executor = module.default;
      if (this.isValidExecutor(executor)) {
        this.executors[executorFile] = executor as Executor;
      } else {
        console.warn(`Invalid executor in file ${executorFile}`);
      }
    } catch (error) {
      console.error(`Failed to load type from ${executorFile}:`, error);
    }
    return this.executors[executorFile];
  }
}
