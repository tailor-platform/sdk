import * as path from "pathe";
import * as rolldown from "rolldown";
import { computeBundlerContextHash, withCache, type BundleCache } from "#/cli/cache/bundle-cache";
import { createStartTransformPlugin } from "#/cli/services/workflow/start-transformer";
import { createBundleLog } from "#/cli/shared/bundle-log";
import { createLogLevelTreeshakeOptions } from "#/cli/shared/bundle-log-level";
import {
  composeFunctionTreeshakeOptions,
  createUserTreeshakeOptions,
} from "#/cli/shared/function-treeshake";
import { logger, styles } from "#/cli/shared/logger";
import { createPlatformBundleDefinePlugin } from "#/cli/shared/platform-bundle-plugin";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";
import { chunkCodeWithSourcemap, type ProjectSourcesFilter } from "#/cli/shared/sourcemap-sources";
import { serializeStartContext, type StartContext } from "#/cli/shared/start-context";
import {
  createTsconfigPathsPlugin,
  type TsconfigLookupCache,
} from "#/cli/shared/tsconfig-paths-plugin";
import { createVirtualEntry } from "#/cli/shared/virtual-entry";
import ml from "#/utils/multiline";
import type { LogLevel, TreeshakeOptions } from "#/configure/config/types";
import type { EffectiveDateDefault } from "#/runtime/types";

/**
 * Options for bundling auth hooks
 */
export interface BundleAuthHooksOptions {
  /** Absolute path to the config file that exports the auth definition */
  configPath: string;
  /** Auth namespace name */
  authName: string;
  /** Dot-path expression to reach the handler from the config's default export */
  handlerAccessPath: string;
  /** Environment variables to inject into the hook args */
  env?: Record<string, string | number | boolean>;
  /** Start context for workflow/job transformations */
  startContext?: StartContext;
  /** Optional bundle cache for skipping unchanged builds */
  cache?: BundleCache;
  /** Whether to enable inline sourcemaps */
  inlineSourcemap?: boolean;
  /** Whether inline sourcemaps embed the source text of installed packages */
  inlineSourcemapDependencySources?: boolean | string[];
  inlineSourcemapProjectSources?: ProjectSourcesFilter;
  /** Controls which console calls are kept in bundled code */
  bundleLogLevel?: LogLevel;
  /** Overrides how unused code is removed from bundled code */
  bundleTreeshake?: TreeshakeOptions;
  /** Directory the tsconfig is resolved against */
  baseDir: string;
  /** Optional tsconfig lookup cache shared across bundles in this CLI run */
  tsconfigCache?: TsconfigLookupCache;
  /** Representation applied to `t` date fields that omit `as` */
  dateDefault?: EffectiveDateDefault;
}

/**
 * Bundle a single auth hook handler.
 *
 * Follows the same pattern as the executor bundler:
 * 1. Generate an in-memory entry module that re-exports the handler as `main`
 * 2. Bundle with rolldown + tree-shaking
 * @param options - Bundle options
 * @returns Map of function name to bundled code
 */
export async function bundleAuthHooks(
  options: BundleAuthHooksOptions,
): Promise<Map<string, string>> {
  const {
    configPath,
    authName,
    handlerAccessPath,
    env = {},
    startContext,
    cache,
    inlineSourcemap,
    inlineSourcemapDependencySources,
    inlineSourcemapProjectSources,
    bundleLogLevel = "DEBUG",
    bundleTreeshake,
    baseDir,
    tsconfigCache,
    dateDefault = "legacy",
  } = options;

  logger.newline();
  logger.log(`Bundling auth hook for ${styles.info(`"${authName}"`)}`);

  const absoluteConfigPath = path.resolve(configPath);

  const tsconfig = await resolveTSConfigWithFallback(baseDir);

  const functionName = `auth-hook--${authName}--before-login`;

  const serializedStartContext = serializeStartContext(startContext);

  // Include sorted env variables as a prefix so that env changes invalidate the cache
  const sortedEnvPrefix = JSON.stringify(
    Object.fromEntries(Object.entries(env).toSorted(([a], [b]) => a.localeCompare(b))),
  );
  const contextHash = computeBundlerContextHash({
    sourceFile: absoluteConfigPath,
    extraContext: JSON.stringify([serializedStartContext, dateDefault]),
    tsconfig,
    inlineSourcemap,
    inlineSourcemapDependencySources,
    inlineSourcemapProjectSources,
    bundleLogLevel,
    bundleTreeshake,
    prefix: sortedEnvPrefix,
  });

  const { code } = await withCache({
    cache,
    kind: "auth-hook",
    name: functionName,
    sourceFile: absoluteConfigPath,
    contextHash,
    async build(cachePlugins, trackDependency) {
      const entryContent = ml /* js */ `
        import _config from "${absoluteConfigPath}";
        const __auth_hook_function = _config.${handlerAccessPath};
        export async function main(args) {
          const env = ${JSON.stringify(env)};
          return await __auth_hook_function({ ...args, env });
        }
      `;
      const entry = createVirtualEntry(
        `auth-hook:${functionName}`,
        entryContent,
        "js",
        absoluteConfigPath,
      );

      const startPlugin = createStartTransformPlugin(startContext);
      const plugins: rolldown.Plugin[] = [entry.plugin];
      if (startPlugin) {
        plugins.push(startPlugin);
      }
      plugins.push(
        createTsconfigPathsPlugin({ onTsconfigRead: trackDependency, cache: tsconfigCache }),
        createPlatformBundleDefinePlugin(undefined, dateDefault),
        ...cachePlugins,
      );

      const bundleLog = createBundleLog({ tsconfig });
      const result = await rolldown.build({
        input: entry.input,
        write: false,
        output: {
          format: "esm",
          sourcemap: true,
          dir: process.cwd(),
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
        transform: {
          define: {
            "process.env.TAILOR_APP_LOG_LEVEL": JSON.stringify(bundleLogLevel),
          },
        },
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
          projectSources: inlineSourcemapProjectSources,
        }),
        packageRuntimeGlobals: {},
      };
    },
  });

  logger.log(`${styles.success("Bundled")} auth hook for ${styles.info(`"${authName}"`)}`);

  const bundledCode = new Map<string, string>();
  bundledCode.set(functionName, code);
  return bundledCode;
}
