import path from "node:path";
import fs from "node:fs";
import { ResolverBundler } from "./bundler";
import { PipelineResolverServiceConfig } from "./types";
import { measure } from "../../performance";
import { Resolver } from "./resolver";
import { isResolver } from "./utils";
import { ManifestAggregator } from "../../generator/manifest/aggregator";
import { ResolverProcessor as ManifestResolverProcessor } from "../../generator/manifest/resolver-processor";

export class PipelineResolverService {
  private bundler: ResolverBundler;
  private resolvers: Resolver<any, any, any, any, any, any>[] = [];

  constructor(
    public readonly namespace: string,
    private readonly config: PipelineResolverServiceConfig,
  ) {
    this.bundler = new ResolverBundler(namespace, config);
  }

  @measure
  async build() {
    await this.loadResolvers();
    await this.bundler.bundle();
  }

  async toManifestJSON() {
    const resolverMetadata: Record<string, any> = {};
    for (const resolver of this.resolvers) {
      const metadata =
        await ManifestResolverProcessor.processResolver(resolver);
      resolverMetadata[resolver.name] = metadata;
    }

    // ManifestAggregatorを使用してJSON生成
    const result = ManifestAggregator.aggregate(
      {
        types: {},
        resolvers: resolverMetadata,
      },
      ".",
      this.namespace,
    );

    if (result.errors && result.errors.length > 0) {
      throw new Error(`Manifest生成エラー: ${result.errors.join(", ")}`);
    }

    const manifestFile = result.files.find((f) =>
      f.path.endsWith("manifest.json"),
    );
    if (manifestFile) {
      return JSON.parse(manifestFile.content);
    }

    throw new Error("Manifestファイルが生成されませんでした");
  }

  @measure
  private async loadResolvers(): Promise<void> {
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
      try {
        const resolverModule = await import(resolverFile);
        const resolver = resolverModule.default;
        if (isResolver(resolver)) {
          this.resolvers.push(resolver);
        }
      } catch (error) {
        console.error(`Failed to load resolver from ${resolverFile}:`, error);
      }
    }
  }

  getResolvers(): Resolver<any, any, any, any, any, any>[] {
    return this.resolvers;
  }
}
