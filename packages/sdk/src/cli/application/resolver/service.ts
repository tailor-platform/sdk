import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
import { type Resolver, ResolverSchema } from "@/parser/service/resolver";
import { type ResolverServiceConfig } from "@/parser/service/resolver/types";

export type ResolverService = {
  readonly namespace: string;
  readonly config: ResolverServiceConfig;
  getResolvers: () => Record<string, Resolver>;
  loadResolvers: () => Promise<void>;
};

/**
 * Creates a new ResolverService instance.
 * @param namespace - The namespace for this resolver service
 * @param config - The resolver service configuration
 * @returns A new ResolverService instance
 */
export function createResolverService(
  namespace: string,
  config: ResolverServiceConfig,
): ResolverService {
  const resolvers: Record<string, Resolver> = {};

  const loadResolverForFile = async (resolverFile: string): Promise<Resolver | undefined> => {
    try {
      const resolverModule = await import(pathToFileURL(resolverFile).href);
      const result = ResolverSchema.safeParse(resolverModule.default);
      if (result.success) {
        const relativePath = path.relative(process.cwd(), resolverFile);
        logger.log(
          `Resolver: ${styles.successBright(`"${result.data.name}"`)} loaded from ${styles.path(relativePath)}`,
        );
        resolvers[resolverFile] = result.data;
        return result.data;
      }
    } catch (error) {
      const relativePath = path.relative(process.cwd(), resolverFile);
      logger.error(`Failed to load resolver from ${styles.bold(relativePath)}`);
      logger.error(String(error));
      throw error;
    }
    return undefined;
  };

  return {
    namespace,
    config,
    getResolvers: () => resolvers,
    loadResolvers: async () => {
      if (Object.keys(resolvers).length > 0) {
        return;
      }
      if (!config.files || config.files.length === 0) {
        return;
      }

      const resolverFiles = loadFilesWithIgnores(config);

      logger.log(
        `Found ${styles.highlight(resolverFiles.length.toString())} resolver files for service ${styles.highlight(`"${namespace}"`)}`,
      );

      await Promise.all(resolverFiles.map((resolverFile) => loadResolverForFile(resolverFile)));
    },
  };
}
