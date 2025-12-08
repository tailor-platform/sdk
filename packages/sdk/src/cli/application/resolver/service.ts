import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { styleText } from "node:util";
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
    if (Object.keys(this.resolvers).length > 0) {
      return;
    }
    if (!this.config.files || this.config.files.length === 0) {
      return;
    }

    const resolverFiles = loadFilesWithIgnores(this.config);

    console.log("");
    console.log(
      "Found",
      styleText("cyanBright", resolverFiles.length.toString()),
      "resolver files for service",
      styleText("cyanBright", `"${this.namespace}"`),
    );

    await Promise.all(
      resolverFiles.map((resolverFile) =>
        this.loadResolverForFile(resolverFile),
      ),
    );
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
        const relativePath = path.relative(process.cwd(), resolverFile);
        console.log(
          "Resolver:",
          styleText("greenBright", `"${result.data.name}"`),
          "loaded from",
          styleText("cyan", relativePath),
        );
        this.resolvers[resolverFile] = result.data;
        return result.data;
      }
    } catch (error) {
      const relativePath = path.relative(process.cwd(), resolverFile);
      console.error(
        styleText("red", "Failed to load resolver from"),
        styleText("redBright", relativePath),
      );
      console.error(error);
      throw error;
    }
    return undefined;
  }

  getResolvers(): Record<string, Resolver> {
    return this.resolvers;
  }
}
