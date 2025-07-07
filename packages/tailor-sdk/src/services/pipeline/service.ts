import path from "node:path";
import fs from "node:fs";
import { ResolverBundler } from "./bundler";
import { PipelineResolverServiceConfig } from "./types";
import { measure } from "@/performance";
import { Resolver } from "./resolver";
import { isResolver } from "./utils";
import { ManifestAggregator } from "@/generator/builtin/manifest/aggregator";
import {
  ResolverProcessor,
  ResolverManifestMetadata,
} from "@/generator/builtin/manifest/resolver-processor";

export class PipelineResolverService {
  private bundler: ResolverBundler;
  private resolvers: Record<string, Resolver> = {};

  constructor(
    public readonly namespace: string,
    private readonly config: PipelineResolverServiceConfig,
  ) {
    this.bundler = new ResolverBundler(namespace, config);
  }

  @measure
  async build() {
    await this.bundler.bundle();
  }

  async toManifestJSON() {
    const resolverMetadata: Record<string, ResolverManifestMetadata> = {};
    for (const resolver of Object.values(this.resolvers)) {
      const metadata = await ResolverProcessor.processResolver(resolver);
      resolverMetadata[resolver.name] = metadata;
    }

    // ManifestAggregatorを使用してJSON生成
    const result = await ManifestAggregator.aggregate(
      {
        types: {},
        resolvers: resolverMetadata,
      },
      this.namespace,
      undefined, // workspace
    );

    if (result.errors && result.errors.length > 0) {
      throw new Error(`Manifest生成エラー: ${result.errors.join(", ")}`);
    }

    const manifestFile = result.files.find((f) =>
      f.path.endsWith("manifest.cue"),
    );
    if (manifestFile) {
      return JSON.parse(manifestFile.content);
    }

    throw new Error("Manifestファイルが生成されませんでした");
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
