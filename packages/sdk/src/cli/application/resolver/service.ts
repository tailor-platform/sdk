import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
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

    logger.log(
      `Found ${styles.highlight(resolverFiles.length.toString())} resolver files for service ${styles.highlight(`"${this.namespace}"`)}`,
    );

    await Promise.all(resolverFiles.map((resolverFile) => this.loadResolverForFile(resolverFile)));
  }

  async loadResolverForFile(resolverFile: string) {
    try {
      const resolverModule = await import(pathToFileURL(resolverFile).href);
      const result = ResolverSchema.safeParse(resolverModule.default);
      if (result.success) {
        const relativePath = path.relative(process.cwd(), resolverFile);
        logger.log(
          `Resolver: ${styles.successBright(`"${result.data.name}"`)} loaded from ${styles.path(relativePath)}`,
        );
        this.resolvers[resolverFile] = result.data;
        return result.data;
      }
    } catch (error) {
      const relativePath = path.relative(process.cwd(), resolverFile);
      logger.error(
        `${styles.error("Failed to load resolver from")} ${styles.errorBright(relativePath)}`,
      );
      logger.error(String(error));
      throw error;
    }
    return undefined;
  }

  getResolvers(): Record<string, Resolver> {
    return this.resolvers;
  }
}
