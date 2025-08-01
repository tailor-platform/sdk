import path from "node:path";
import fs from "node:fs";
import * as rolldown from "rolldown";
import { getDistDir } from "@/config";
import { BundlerConfig, ILoader, ITransformer } from "./types";

export class Bundler<T> {
  private readonly loader: ILoader<T>;
  private readonly transformer: ITransformer<T>;

  constructor(private readonly config: BundlerConfig<T>) {
    this.loader = config.loader;
    this.transformer = config.transformer;
  }

  async bundle(): Promise<void> {
    try {
      const files = await this.detectFiles();
      if (files.length === 0) {
        throw new Error(
          `No files found matching pattern: ${this.config.serviceConfig.files?.join(
            ", ",
          )}`,
        );
      }

      console.log(
        `Found ${files.length} files for service "${this.config.namespace}"`,
      );

      await Promise.all(
        files.map(async (file) => {
          await this.processFile(file);
        }),
      );

      console.log(
        `Successfully bundled files for service "${this.config.namespace}"`,
      );
    } catch (error) {
      console.error(
        `Bundle failed for service ${this.config.namespace}:`,
        error,
      );
      throw error;
    }
  }

  private async detectFiles(): Promise<string[]> {
    if (
      !this.config.serviceConfig.files ||
      this.config.serviceConfig.files.length === 0
    ) {
      return [];
    }

    const files: string[] = [];

    for (const pattern of this.config.serviceConfig.files) {
      const absolutePattern = path.resolve(process.cwd(), pattern);

      try {
        const matchedFiles = fs.globSync(absolutePattern);
        files.push(...matchedFiles);
      } catch (error) {
        console.warn(`Failed to glob pattern "${pattern}":`, error);
      }
    }

    return files;
  }

  private async processFile(file: string): Promise<void> {
    const item = await this.loader.load(file);

    // Check if this item should be processed
    if (this.config.shouldProcess && !this.config.shouldProcess(item)) {
      console.log(`Skipping item based on shouldProcess condition`);
      return;
    }

    // Extract name from item - assume it has a 'name' property
    const itemName = (item as any).name;

    const outputFile = path.join(
      getDistDir(),
      this.config.outputDirs.preBundle,
      `${itemName}.js`,
    );

    await this.preBundle(file, outputFile);

    const transformedFiles = this.transformer.transform(
      outputFile,
      item,
      getDistDir(),
    );

    // Post-bundle the transformed files
    if (transformedFiles.length > 0) {
      await this.postBundle(transformedFiles);
    }
  }

  private async preBundle(input: string, output: string): Promise<void> {
    const outputDir = path.dirname(output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await rolldown.build(
      rolldown.defineConfig({
        input: input,
        output: {
          file: output,
          format: "esm",
          sourcemap: false,
          minify: false,
        },
        external: (id) => {
          if (id.includes("node_modules")) {
            return true;
          }

          if (
            !id.startsWith(".") &&
            !id.startsWith("/") &&
            !id.startsWith("@/") &&
            !id.startsWith("#") &&
            !id.startsWith("~") &&
            !id.includes("\\")
          ) {
            return true;
          }

          return false;
        },
        treeshake: {
          moduleSideEffects: false,
          annotations: true,
          unknownGlobalSideEffects: false,
        },
        logLevel: "silent",
      }) as rolldown.BuildOptions,
    );

    const stats = fs.statSync(output);
    console.log(`Pre-bundle output size: ${(stats.size / 1024).toFixed(2)} KB`);
  }

  private async postBundle(files: string[]): Promise<void> {
    const outputDir = path.join(
      getDistDir(),
      this.config.outputDirs.postBundle,
    );
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await Promise.all(
      files.map(async (file) => {
        const outputFile = path.join(outputDir, path.basename(file));

        await rolldown.build(
          rolldown.defineConfig({
            input: path.resolve(file),
            output: {
              file: outputFile,
              format: "esm",
              sourcemap: true,
              minify: true,
            },
            treeshake: {
              moduleSideEffects: false,
              annotations: true,
              unknownGlobalSideEffects: false,
            },
            logLevel: "silent",
          }) as rolldown.BuildOptions,
        );
      }),
    );
  }
}
