import path from "node:path";
import fs from "node:fs";
import * as rolldown from "rolldown";
import * as rollup from "rollup";
import { minify } from "rollup-plugin-esbuild-minify";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { ResolverLoader } from "./loader";
import { CodeTransformer } from "./transformer";
import { getDistDir } from "@/config";
import { PipelineResolverServiceConfig } from "../types";
import { measure } from "@/performance";

export class ResolverBundler {
  private readonly resolverLoader: ResolverLoader;
  private readonly transformer: CodeTransformer;

  constructor(
    private readonly namespace: string,
    private readonly config: PipelineResolverServiceConfig,
  ) {
    this.resolverLoader = new ResolverLoader();
    this.transformer = new CodeTransformer();
  }

  @measure
  async bundle(): Promise<void> {
    try {
      const resolverFiles = await this.detectResolverFiles();
      if (resolverFiles.length === 0) {
        throw new Error(
          `No resolver files found matching pattern: ${this.config.files?.join(
            ", ",
          )}`,
        );
      }

      console.log(
        `Found ${resolverFiles.length} resolver files for service "${this.namespace}"`,
      );

      await Promise.all(
        resolverFiles.map(async (resolverFile) => {
          await this.processResolverFile(resolverFile);
        }),
      );

      console.log(
        `Successfully bundled resolvers for service "${this.namespace}"`,
      );
    } catch (error) {
      console.error(`Bundle failed for service ${this.namespace}:`, error);
      throw error;
    }
  }

  @measure
  private async detectResolverFiles(): Promise<string[]> {
    if (!this.config.files || this.config.files.length === 0) {
      return [];
    }

    const resolverFiles: string[] = [];

    for (const pattern of this.config.files) {
      const absolutePattern = path.resolve(process.cwd(), pattern);

      try {
        const matchedFiles = fs.globSync(absolutePattern);
        resolverFiles.push(...matchedFiles);
      } catch (error) {
        console.warn(`Failed to glob pattern "${pattern}":`, error);
      }
    }

    return resolverFiles;
  }

  @measure
  private async processResolverFile(resolverFile: string): Promise<void> {
    const resolver = await this.resolverLoader.load(resolverFile);

    const outputFile = path.join(
      getDistDir(),
      "resolvers",
      `${resolver.name}.js`,
    );

    await this.preBundle(resolverFile, outputFile);

    const stepOutputFiles = this.transformer.transform(
      outputFile,
      resolver,
      getDistDir(),
    );

    await this.postBundle(stepOutputFiles);
  }

  @measure
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

    // Log bundle size for debugging
    const stats = fs.statSync(output);
    console.log(`Pre-bundle output size: ${(stats.size / 1024).toFixed(2)} KB`);
  }

  @measure
  private async postBundle(stepFiles: string[]): Promise<void> {
    const outputDir = path.join(getDistDir(), "functions");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await Promise.all(
      stepFiles.map(async (file) => {
        const outputFile = path.join(outputDir, path.basename(file));

        const bundle = await rollup.rollup(
          rollup.defineConfig({
            input: file,
            treeshake: {
              moduleSideEffects: false,
              propertyReadSideEffects: false,
              tryCatchDeoptimization: false,
              unknownGlobalSideEffects: false,
              preset: "smallest",
            },
            plugins: [
              nodeResolve({
                preferBuiltins: false,
                browser: false,
              }),
              minify({}),
            ],
            logLevel: "silent",
          }) as rollup.RollupOptions,
        );

        await bundle.write({
          file: outputFile,
          format: "esm",
          compact: true,
          sourcemap: true,
        });
      }),
    );
  }
}
