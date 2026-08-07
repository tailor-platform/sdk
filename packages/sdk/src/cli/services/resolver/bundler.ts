import * as path from "pathe";
import * as rolldown from "rolldown";
import { type BundleCache, computeBundlerContextHash, withCache } from "#/cli/cache/bundle-cache";
import { type FileLoadConfig, loadFilesWithIgnores } from "#/cli/services/file-loader";
import { createStartTransformPlugin } from "#/cli/services/workflow/start-transformer";
import { withBundleConcurrency } from "#/cli/shared/bundle-concurrency";
import { createBundleLog } from "#/cli/shared/bundle-log";
import { createLogLevelTreeshakeOptions } from "#/cli/shared/bundle-log-level";
import { composeFunctionTreeshakeOptions } from "#/cli/shared/function-treeshake";
import { logger, styles } from "#/cli/shared/logger";
import { platformBundleDefinePlugin } from "#/cli/shared/platform-bundle-plugin";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";
import { buildResolverPermissionAndInputCheckExpr, INVOKER_EXPR } from "#/cli/shared/runtime-exprs";
import { serializeStartContext, type StartContext } from "#/cli/shared/start-context";
import {
  createTsconfigPathsPlugin,
  type TsconfigLookupCache,
} from "#/cli/shared/tsconfig-paths-plugin";
import { createVirtualEntry } from "#/cli/shared/virtual-entry";
import ml from "#/utils/multiline";
import { loadResolver } from "./loader";
import type { LogLevel } from "#/configure/config/types";
import type { Resolver } from "#/types/resolver.generated";

interface ResolverInfo {
  name: string;
  sourceFile: string;
  permission: Resolver["permission"];
}

export interface BundleResolversOptions {
  /** Resolver namespace name */
  namespace: string;
  /** Resolver file loading configuration */
  config: FileLoadConfig;
  /** Directory the config's file patterns are resolved against */
  baseDir: string;
  /** The namespace's `defaultPermission`, applied to resolvers declaring none */
  defaultPermission?: Resolver["permission"];
  /** Start context for workflow/job transformations */
  startContext?: StartContext;
  /** Optional bundle cache for skipping unchanged builds */
  cache?: BundleCache;
  /** Whether to enable inline sourcemaps */
  inlineSourcemap?: boolean;
  /** Controls which console calls are kept in bundled code */
  bundleLogLevel?: LogLevel;
  /** Optional tsconfig lookup cache shared across bundles in this CLI run */
  tsconfigCache?: TsconfigLookupCache;
}

/**
 * Bundle resolvers for the specified namespace
 *
 * This function:
 * 1. Uses a transform plugin to add validation wrapper during bundling
 * 2. Creates an in-memory entry module
 * 3. Bundles in a single step with tree-shaking
 * @param options - Bundle options
 * @returns Map of resolver name to bundled code
 */
export async function bundleResolvers(
  options: BundleResolversOptions,
): Promise<Map<string, string>> {
  const {
    namespace,
    config,
    baseDir,
    defaultPermission,
    startContext,
    cache,
    inlineSourcemap,
    bundleLogLevel = "DEBUG",
    tsconfigCache,
  } = options;
  const bundledCode = new Map<string, string>();
  const files = loadFilesWithIgnores(config, baseDir);
  if (files.length === 0) {
    logger.warn(`No resolver files found for patterns: ${config.files.join(", ")}`);
    return bundledCode;
  }

  logger.newline();
  logger.log(
    `Bundling ${styles.highlight(files.length.toString())} files for ${styles.info(
      `"${namespace}"`,
    )}`,
  );

  // Load all resolvers to get their names
  const resolvers: ResolverInfo[] = [];
  for (const file of files) {
    const resolver = await loadResolver(file);
    if (!resolver) {
      logger.debug(`  Skipping: ${file} (could not be loaded)`);
      continue;
    }
    resolvers.push({
      name: resolver.name,
      sourceFile: file,
      permission: resolver.permission,
    });
  }

  const tsconfig = await resolveTSConfigWithFallback(baseDir);

  // Process each resolver, capped by TAILOR_BUNDLE_CONCURRENCY to bound native
  // memory use (each rolldown.build allocates its own module graph).
  const results = await withBundleConcurrency(resolvers, (resolver) =>
    bundleSingleResolver({
      namespace,
      resolver,
      tsconfig,
      defaultPermission,
      startContext,
      cache,
      inlineSourcemap,
      bundleLogLevel,
      tsconfigCache,
    }),
  );

  for (const [name, code] of results) {
    bundledCode.set(name, code);
  }

  logger.log(`${styles.success("Bundled")} ${styles.info(`"${namespace}"`)}`);

  return bundledCode;
}

type BundleSingleResolverOptions = Omit<BundleResolversOptions, "config" | "baseDir"> & {
  resolver: ResolverInfo;
  tsconfig: string | undefined;
};

async function bundleSingleResolver(
  options: BundleSingleResolverOptions,
): Promise<[string, string]> {
  const {
    namespace,
    resolver,
    tsconfig,
    defaultPermission,
    startContext,
    cache,
    inlineSourcemap,
    bundleLogLevel = "DEBUG",
    tsconfigCache,
  } = options;
  const serializedStartContext = serializeStartContext(startContext);

  const contextHash = computeBundlerContextHash({
    sourceFile: resolver.sourceFile,
    // The namespace default is part of the generated guard but lives in the
    // config file, not in any resolver source, so a cached bundle would
    // otherwise survive a change to it. Encoded as a pair rather than joined,
    // so no separator has to be a character neither value can contain.
    extraContext: JSON.stringify([serializedStartContext, defaultPermission ?? null]),
    tsconfig,
    inlineSourcemap,
    bundleLogLevel,
  });

  const code = await withCache({
    cache,
    kind: "resolver",
    namespace,
    name: resolver.name,
    sourceFile: resolver.sourceFile,
    contextHash,
    async build(cachePlugins, trackDependency) {
      const absoluteSourcePath = path.resolve(resolver.sourceFile);
      const guardAndInputCheckExpr = buildResolverPermissionAndInputCheckExpr({
        permission: resolver.permission,
        defaultPermission,
      });

      const entryContent = ml /* js */ `
        import _internalResolver from "${absoluteSourcePath}";
        import { t } from "@tailor-platform/sdk";

        const $tailor_resolver_body = async (context) => {
          const invoker = ${INVOKER_EXPR};
          ${guardAndInputCheckExpr}
          return _internalResolver.body({ ...context, invoker });
        };

        export { $tailor_resolver_body as main };
      `;
      const entry = createVirtualEntry(
        `resolver:${resolver.name}`,
        entryContent,
        "js",
        absoluteSourcePath,
      );

      const startPlugin = createStartTransformPlugin(startContext);
      const plugins: rolldown.Plugin[] = [entry.plugin];
      if (startPlugin) {
        plugins.push(startPlugin);
      }
      plugins.push(
        createTsconfigPathsPlugin({ onTsconfigRead: trackDependency, cache: tsconfigCache }),
        platformBundleDefinePlugin,
        ...cachePlugins,
      );

      const bundleLog = createBundleLog({ tsconfig });
      const result = await rolldown.build({
        input: entry.input,
        write: false,
        output: {
          format: "esm",
          sourcemap: inlineSourcemap ? "inline" : true,
          minify: inlineSourcemap
            ? {
                mangle: {
                  keepNames: true,
                },
              }
            : true,
          codeSplitting: false,
        },
        tsconfig,
        plugins,
        treeshake: composeFunctionTreeshakeOptions([
          createLogLevelTreeshakeOptions(bundleLogLevel),
        ]),
        ...bundleLog.options,
      } as rolldown.BuildOptions);
      bundleLog.assertAllResolved();

      return result.output[0].code;
    },
  });

  return [resolver.name, code];
}
