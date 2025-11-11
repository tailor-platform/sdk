import { pathToFileURL } from "node:url";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { type ResolverServiceConfig } from "@/configure/services/resolver/types";
import { type Resolver, ResolverSchema } from "@/parser/service/resolver";

export class ResolverService {
  private resolvers: Record<string, Resolver> = {};

  constructor(
    public readonly namespace: string,
    public readonly config: ResolverServiceConfig,
  ) {}

  async loadResolvers(): Promise<void> {
    if (!this.config.files || this.config.files.length === 0) {
      return;
    }

    const resolverFiles = loadFilesWithIgnores(this.config);

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
