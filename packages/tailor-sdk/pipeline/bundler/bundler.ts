import path from "node:path";
import fs from "node:fs";
import * as rolldown from "rolldown";
import * as rollup from "rollup";
import { minify } from "rollup-plugin-esbuild-minify";
import { ResolverExtractor } from "./extractor";
import { CodeTransformer } from "./transformer";
import { getDistPath } from "../../workspace";
import { PipelineResolverServiceConfig } from "../types";

export class ResolverBundler {
  private readonly tempDir: string;
  private readonly extractor: ResolverExtractor;
  private readonly transformer: CodeTransformer;

  constructor(
    private readonly namespace: string,
    private readonly config: PipelineResolverServiceConfig,
  ) {
    this.tempDir = path.join(process.cwd(), ".tailor-sdk");
    this.extractor = new ResolverExtractor();
    this.transformer = new CodeTransformer();
  }

  async bundle(): Promise<void> {
    try {
      // Clean up temp directory
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true });
      }
      fs.mkdirSync(this.tempDir, { recursive: true });

      // Detect resolver files
      const resolverFiles = await this.detectResolverFiles();
      if (resolverFiles.length === 0) {
        throw new Error(
          `No resolver files found matching pattern: ${
            this.config.files?.join(", ")
          }`,
        );
      }

      console.log(
        `Found ${resolverFiles.length} resolver files for service "${this.namespace}"`,
      );

      // Process each resolver file
      await Promise.all(
        resolverFiles.map(async (resolverFile) => {
          await this.processResolverFile(resolverFile);
        }),
      );

      console.log(
        `Successfully bundled resolvers for service "${this.namespace}"`,
      );
    } catch (error) {
      console.error(
        `Bundle failed for service ${this.namespace}:`,
        error,
      );
      throw error;
    }
  }

  private async detectResolverFiles(): Promise<string[]> {
    if (!this.config.files || this.config.files.length === 0) {
      return [];
    }

    const resolverFiles: string[] = [];

    for (const pattern of this.config.files) {
      // Convert glob pattern to regex
      const baseDir = path.dirname(pattern);
      const filePattern = path.basename(pattern);

      // Simple glob to regex conversion (supports * wildcard)
      const regexPattern = filePattern
        .replace(/\./g, "\\.")
        .replace(/\*/g, ".*");
      const regex = new RegExp(`^${regexPattern}$`);

      // Read directory and filter files
      const absoluteBaseDir = path.resolve(process.cwd(), baseDir);
      if (fs.existsSync(absoluteBaseDir)) {
        const files = fs.readdirSync(absoluteBaseDir);
        const matchedFiles = files
          .filter((file) => regex.test(file))
          .map((file) => path.join(absoluteBaseDir, file));
        resolverFiles.push(...matchedFiles);
      }
    }

    return resolverFiles;
  }

  private async processResolverFile(resolverFile: string): Promise<void> {
    // Extract steps and resolver name from resolver
    const resolver = await this.extractor.summarize(resolverFile);

    // Generate output filename
    const outputFile = path.join(
      this.tempDir,
      "resolvers",
      `${resolver.name}.js`,
    );

    // Pre-bundle the resolver file
    await this.preBundle(resolverFile, outputFile);

    // Transform the bundled file
    const stepOutputFiles = this.transformer.transform(
      outputFile,
      resolver,
      this.tempDir,
    );

    // Post-bundle the step files
    await this.postBundle(stepOutputFiles);
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
        external: ["@tailor-platform/tailor-sdk"],
      }) as rolldown.BuildOptions,
    );
  }

  private async postBundle(stepFiles: string[]): Promise<void> {
    const distPath = getDistPath() || "dist";
    const outputDir = path.join(distPath, "functions");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await Promise.all(
      stepFiles.map(async (file) => {
        const outputFile = path.join(outputDir, path.basename(file));

        const bundle = await rollup.rollup(
          rollup.defineConfig({
            input: file,
            treeshake: true,
            plugins: [minify({})],
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
