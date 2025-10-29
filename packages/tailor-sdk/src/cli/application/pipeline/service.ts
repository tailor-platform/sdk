import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { type PipelineResolverServiceConfig } from "@/configure/services/pipeline/types";
import { type Resolver, ResolverSchema } from "@/parser/service/pipeline";

export class PipelineResolverService {
  private resolvers: Record<string, Resolver> = {};

  constructor(
    public readonly namespace: string,
    public readonly config: PipelineResolverServiceConfig,
  ) {}

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
      const baseUrl = pathToFileURL(resolverFile).href;
      const moduleSpecifier =
        timestamp === undefined
          ? baseUrl
          : `${baseUrl}?t=${timestamp.getTime()}`;

      const resolverModule = await import(moduleSpecifier);
      const result = ResolverSchema.safeParse(resolverModule.default);
      if (result.success) {
        this.resolvers[resolverFile] = result.data;
      }
    } catch (error) {
      console.error(`Failed to load resolver from ${resolverFile}:`, error);
      throw error;
    }
    return this.resolvers[resolverFile];
  }

  getResolvers(): Record<string, Resolver> {
    return this.resolvers;
  }
}
