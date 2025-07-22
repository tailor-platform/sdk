import path from "node:path";
import fs from "node:fs";
import { Bundler, BundlerConfig } from "@/bundler";
import { ResolverLoader } from "./bundler/loader";
import { CodeTransformer } from "./bundler/transformer";
import { PipelineResolverServiceConfig } from "./types";
import { measure } from "@/performance";
import { Resolver } from "./resolver";
import { isResolver } from "./utils";

export class PipelineResolverService {
  private bundler: Bundler<Resolver<any, any, any, any, any, any>>;
  private resolvers: Record<string, Resolver> = {};

  constructor(
    public readonly namespace: string,
    private readonly config: PipelineResolverServiceConfig,
  ) {
    const bundlerConfig: BundlerConfig<Resolver<any, any, any, any, any, any>> =
      {
        namespace,
        serviceConfig: config,
        loader: new ResolverLoader(),
        transformer: new CodeTransformer(),
        outputDirs: {
          preBundle: "resolvers",
          postBundle: "functions",
        },
      };
    this.bundler = new Bundler(bundlerConfig);
  }

  @measure
  async build() {
    await this.bundler.bundle();
  }

  @measure
  async loadResolvers(): Promise<void> {
    if (!this.config.files || this.config.files.length === 0) {
      return;
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

    for (const resolverFile of resolverFiles) {
      await this.loadResolverForFile(resolverFile);
    }
  }

  async loadResolverForFile(resolverFile: string, timestamp?: Date) {
    try {
      const resolverModule = await import(
        [resolverFile, ...(timestamp ? [timestamp.getTime()] : [])].join("?t=")
      );
      const resolver = resolverModule.default;
      if (isResolver(resolver)) {
        this.resolvers[resolverFile] = resolver;
      }
    } catch (error) {
      console.error(`Failed to load resolver from ${resolverFile}:`, error);
    }
    return this.resolvers[resolverFile];
  }

  getResolvers(): Record<string, Resolver> {
    return this.resolvers;
  }
}
