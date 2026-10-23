import * as path from "pathe";
import * as rolldown from "rolldown";
import { type BundleCache, computeBundlerContextHash, withCache } from "#/cli/cache/bundle-cache";
import { createStartTransformPlugin } from "#/cli/services/workflow/start-transformer";
import { withBundleConcurrency } from "#/cli/shared/bundle-concurrency";
import { createBundleLog } from "#/cli/shared/bundle-log";
import { createLogLevelTreeshakeOptions } from "#/cli/shared/bundle-log-level";
import {
  checkForbiddenRuntimeGlobals,
  assertPackageRuntimeGlobalsAllowed,
} from "#/cli/shared/forbidden-runtime-globals";
import {
  composeFunctionTreeshakeOptions,
  createUserTreeshakeOptions,
} from "#/cli/shared/function-treeshake";
import { logger, styles } from "#/cli/shared/logger";
import { createPlatformBundleDefinePlugin } from "#/cli/shared/platform-bundle-plugin";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";
import {
  buildResolverResultSerialization,
  buildResolverValidatedInputExpr,
  INVOKER_EXPR,
  resolverDateRepresentations,
} from "#/cli/shared/runtime-exprs";
import { chunkCodeWithSourcemap } from "#/cli/shared/sourcemap-sources";
import { serializeStartContext, type StartContext } from "#/cli/shared/start-context";
import {
  createTsconfigPathsPlugin,
  type TsconfigLookupCache,
} from "#/cli/shared/tsconfig-paths-plugin";
import { createVirtualEntry } from "#/cli/shared/virtual-entry";
import ml from "#/utils/multiline";
import { loadResolver } from "./loader";
import type { AllowedRuntimeGlobals, LogLevel, TreeshakeOptions } from "#/configure/config/types";
import type { EffectiveDateDefault } from "#/runtime/types";
import type { Resolver } from "#/types/resolver.generated";

interface ResolverInfo {
  name: string;
  sourceFile: string;
  permission: Resolver["permission"];
  input: Resolver["input"];
  output: Resolver["output"];
}

export interface BundleResolversOptions {
  /** Resolver namespace name */
  namespace: string;
  /** Absolute paths of the resolver files to bundle */
  files: ReadonlyArray<string>;
  /** Directory the application's tsconfig is resolved from */
  baseDir: string;
  /** The namespace's `defaultPermission`, applied to resolvers declaring none */
  defaultPermission?: Resolver["permission"];
  /** Start context for workflow/job transformations */
  startContext?: StartContext;
  /** Optional bundle cache for skipping unchanged builds */
  cache?: BundleCache;
  /** Whether to enable inline sourcemaps */
  inlineSourcemap?: boolean;
  /** Whether inline sourcemaps embed the source text of installed packages */
  inlineSourcemapDependencySources?: boolean | string[];
  /** Controls which console calls are kept in bundled code */
  bundleLogLevel?: LogLevel;
  /** Overrides how unused code is removed from bundled code */
  bundleTreeshake?: TreeshakeOptions;
  /** Optional tsconfig lookup cache shared across bundles in this CLI run */
  tsconfigCache?: TsconfigLookupCache;
  /** Globals each installed package may reference */
  allowedRuntimeGlobals?: AllowedRuntimeGlobals;
  /** Representation applied to `t` date fields that omit `as` */
  dateDefault?: EffectiveDateDefault;
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
    files,
    baseDir,
    defaultPermission,
    startContext,
    cache,
    inlineSourcemap,
    inlineSourcemapDependencySources,
    bundleLogLevel = "DEBUG",
    bundleTreeshake,
    tsconfigCache,
    allowedRuntimeGlobals,
    dateDefault,
  } = options;
  const bundledCode = new Map<string, string>();
  if (files.length === 0) {
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
      input: resolver.input,
      output: resolver.output,
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
      inlineSourcemapDependencySources,
      bundleLogLevel,
      bundleTreeshake,
      tsconfigCache,
      allowedRuntimeGlobals,
      dateDefault,
    }),
  );

  for (const [name, code] of results) {
    bundledCode.set(name, code);
  }

  logger.log(`${styles.success("Bundled")} ${styles.info(`"${namespace}"`)}`);

  return bundledCode;
}

type BundleSingleResolverOptions = Omit<BundleResolversOptions, "files" | "baseDir"> & {
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
    inlineSourcemapDependencySources,
    bundleLogLevel = "DEBUG",
    bundleTreeshake,
    tsconfigCache,
    allowedRuntimeGlobals,
    dateDefault = "legacy",
  } = options;
  const serializedStartContext = serializeStartContext(startContext);

  const contextHash = computeBundlerContextHash({
    sourceFile: resolver.sourceFile,
    // The namespace default and the date default are part of the generated
    // entry but live in the config file, not in any resolver source, so a
    // cached bundle would otherwise survive a change to them. Encoded as a
    // tuple rather than joined, so no separator has to be a character neither
    // value can contain.
    extraContext: JSON.stringify([serializedStartContext, defaultPermission ?? null, dateDefault]),
    tsconfig,
    inlineSourcemap,
    inlineSourcemapDependencySources,
    bundleLogLevel,
    bundleTreeshake,
  });

  const { code, packageRuntimeGlobals } = await withCache({
    cache,
    kind: "resolver",
    namespace,
    name: resolver.name,
    sourceFile: resolver.sourceFile,
    contextHash,
    async build(cachePlugins, trackDependency) {
      const absoluteSourcePath = path.resolve(resolver.sourceFile);
      const validatedInputExpr = buildResolverValidatedInputExpr({
        permission: resolver.permission,
        defaultPermission,
      });
      const { importStatement, resultExpr } = buildResolverResultSerialization(
        resolver.output,
        dateDefault,
      );

      const entryContent = ml /* js */ `
        import _internalResolver from "${absoluteSourcePath}";
        import { t } from "@tailor-platform/sdk";
        ${importStatement}

        const $tailor_resolver_body = async (context) => {
          const invoker = ${INVOKER_EXPR};
          const input = ${validatedInputExpr};
          const result = await _internalResolver.body({ ...context, input, invoker });
          return ${resultExpr};
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
        createPlatformBundleDefinePlugin(
          resolverDateRepresentations(resolver, dateDefault),
          dateDefault,
        ),
        ...cachePlugins,
      );

      const bundleLog = createBundleLog({ tsconfig });
      const result = await rolldown.build({
        input: entry.input,
        write: false,
        output: {
          format: "esm",
          sourcemap: true,
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
          createUserTreeshakeOptions(bundleTreeshake),
        ]),
        ...bundleLog.options,
      } as rolldown.BuildOptions);
      bundleLog.assertAllResolved();

      const [chunk] = result.output;
      return {
        code: chunkCodeWithSourcemap({
          chunk,
          inlineSourcemap: inlineSourcemap ?? false,
          dependencySources: inlineSourcemapDependencySources ?? false,
        }),
        packageRuntimeGlobals: checkForbiddenRuntimeGlobals(chunk, `Resolver "${resolver.name}"`),
      };
    },
  });
  assertPackageRuntimeGlobalsAllowed(
    packageRuntimeGlobals,
    `Resolver "${resolver.name}"`,
    allowedRuntimeGlobals,
  );

  return [resolver.name, code];
}
