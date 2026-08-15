import * as path from "pathe";
import * as v from "valibot";
import { loadFilesWithIgnores } from "#/cli/services/file-loader";
import { logger, styles } from "#/cli/shared/logger";
import { importUserModule } from "#/cli/shared/user-modules";
import { ResolverSchema } from "#/parser/service/resolver/index";
import { isSdkBranded } from "#/utils/brand";
import { parseResolverDefaultPermission } from "./default-permission";
import type { ResolverServiceConfig } from "#/configure/config/types";
import type { Resolver } from "#/types/resolver.generated";

export type ResolverService = {
  readonly namespace: string;
  readonly config: ResolverServiceConfig;
  /** The namespace's validated `defaultPermission`, applied to resolvers declaring none. */
  readonly defaultPermission: Resolver["permission"] | undefined;
  readonly resolvers: Record<string, Resolver>;
  loadResolvers: () => Promise<void>;
};

/**
 * Creates a new ResolverService instance.
 * @param namespace - The namespace for this resolver service
 * @param config - The resolver service configuration
 * @param baseDir - Directory the config's file patterns are resolved against
 * @returns A new ResolverService instance
 */
export function createResolverService(
  namespace: string,
  config: ResolverServiceConfig,
  baseDir: string,
): ResolverService {
  const resolvers: Record<string, Resolver> = {};
  const defaultPermission = parseResolverDefaultPermission({ namespace, config });

  const loadResolverForFile = async (resolverFile: string): Promise<Resolver | undefined> => {
    try {
      const resolverModule = await importUserModule(resolverFile);
      const result = v.safeParse(ResolverSchema, resolverModule.default);
      if (result.success) {
        const relativePath = path.relative(process.cwd(), resolverFile);
        logger.log(
          `Resolver: ${styles.successBright(`"${result.output.name}"`)} loaded from ${styles.path(relativePath)}`,
        );
        resolvers[resolverFile] = result.output;
        return result.output;
      }
      if (isSdkBranded(resolverModule.default, "resolver")) {
        throw new v.ValiError(result.issues);
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
    defaultPermission,
    get resolvers() {
      return resolvers;
    },
    loadResolvers: async () => {
      if (Object.keys(resolvers).length > 0) {
        return;
      }
      if (config.files.length === 0) {
        return;
      }

      const resolverFiles = loadFilesWithIgnores(config, baseDir);

      logger.log(
        `Found ${styles.highlight(resolverFiles.length.toString())} resolver files for service ${styles.highlight(`"${namespace}"`)}`,
      );

      await Promise.all(resolverFiles.map((resolverFile) => loadResolverForFile(resolverFile)));
      assertUniqueResolverNames(resolvers, namespace);
      warnUndeclaredPermissions({ namespace, defaultPermission, resolvers });
    },
  };
}

type WarnUndeclaredPermissionsParams = {
  namespace: string;
  defaultPermission: Resolver["permission"] | undefined;
  resolvers: Record<string, Resolver>;
};

/**
 * Warn about resolvers that declare no access requirement at all.
 *
 * A namespace-level `defaultPermission` covers every resolver in the
 * namespace, so the warning only fires when the namespace declares none and
 * at least one of its resolvers declares none either — those resolvers are
 * reachable by anonymous callers.
 * @param params - The namespace, its default permission, and its loaded resolvers
 */
function warnUndeclaredPermissions(params: WarnUndeclaredPermissionsParams): void {
  const { namespace, defaultPermission, resolvers } = params;
  if (defaultPermission !== undefined) {
    return;
  }

  const loaded = Object.values(resolvers);
  const undeclared = loaded.filter((resolver) => resolver.permission === undefined);
  if (undeclared.length === 0) {
    return;
  }

  logger.warn(
    `Resolver namespace ${styles.highlight(`"${namespace}"`)}: ${undeclared.length} of ` +
      `${loaded.length} resolvers declare no \`permission\`, so anonymous callers can reach ` +
      `them. Set \`defaultPermission\` on the namespace, or declare \`permission\` on each ` +
      `resolver ("allowAnonymous" if public access is intended).`,
  );
  // Sorted because resolvers load concurrently, so their record order varies per run.
  const names = undeclared.map((resolver) => resolver.name).toSorted();
  logger.debug(`  Resolvers without \`permission\`: ${names.join(", ")}`);
}

/**
 * Assert that every loaded resolver in a namespace has a unique name.
 * Resolvers are stored by source file, so two files declaring the same
 * `name` would otherwise silently share a single bundle cache entry.
 * @param resolvers - Loaded resolvers keyed by source file
 * @param namespace - The namespace the resolvers belong to
 */
function assertUniqueResolverNames(resolvers: Record<string, Resolver>, namespace: string): void {
  const seenNames = new Map<string, string>();
  for (const [file, resolver] of Object.entries(resolvers)) {
    const relativePath = path.relative(process.cwd(), file);
    const existing = seenNames.get(resolver.name);
    if (existing) {
      throw new Error(
        `Duplicate resolver name "${resolver.name}" found in namespace "${namespace}":\n` +
          `  - ${existing}\n` +
          `  - ${relativePath}\n` +
          `Each resolver must have a unique name within a namespace.`,
      );
    }
    seenNames.set(resolver.name, relativePath);
  }
}
