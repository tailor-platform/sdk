import { ResolverBundler } from "./bundler";
import { PipelineResolverServiceConfig } from "./types";
import { measure } from "../performance";
import { SDLTypeMetadata } from "../types/types";
import { Resolver } from "./resolver";
import path from "node:path";
import fs from "node:fs";

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
    // Load resolvers before bundling to collect metadata
    await this.loadResolvers();
    await this.bundler.bundle();
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

        if (resolver instanceof Resolver) {
          this.resolvers.push(resolver);
        }
      } catch (error) {
        console.error(`Failed to load resolver from ${resolverFile}:`, error);
      }
    }
  }

  getResolverSDLMetadata() {
    const metadataList: Array<{
      name: string;
      sdl: string;
      pipelines: Array<{
        name: string;
        description: string;
        operationType: any;
        operationSource: string;
        operationName: string;
      }>;
    }> = [];

    for (const resolver of this.resolvers) {
      const metadata = resolver.toSDLMetadata();
      metadataList.push(metadata);
    }

    return metadataList;
  }
}
