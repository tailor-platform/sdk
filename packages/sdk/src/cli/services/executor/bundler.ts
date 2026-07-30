import * as path from "pathe";
import * as rolldown from "rolldown";
import { computeBundlerContextHash, withCache, type BundleCache } from "#/cli/cache/bundle-cache";
import { loadFilesWithIgnores, type FileLoadConfig } from "#/cli/services/file-loader";
import { createStartTransformPlugin } from "#/cli/services/workflow/start-transformer";
import { withBundleConcurrency } from "#/cli/shared/bundle-concurrency";
import { createBundleLog } from "#/cli/shared/bundle-log";
import { createLogLevelTreeshakeOptions } from "#/cli/shared/bundle-log-level";
import { composeFunctionTreeshakeOptions } from "#/cli/shared/function-treeshake";
import { logger, styles } from "#/cli/shared/logger";
import { platformBundleDefinePlugin } from "#/cli/shared/platform-bundle-plugin";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";
import { INVOKER_EXPR } from "#/cli/shared/runtime-exprs";
import { serializeStartContext, type StartContext } from "#/cli/shared/start-context";
import {
  createTsconfigPathsPlugin,
  type TsconfigLookupCache,
} from "#/cli/shared/tsconfig-paths-plugin";
import { createVirtualEntry } from "#/cli/shared/virtual-entry";
import ml from "#/utils/multiline";
import { loadExecutor } from "./loader";
import type { LogLevel } from "#/configure/config/types";

interface ExecutorInfo {
  name: string;
  sourceFile: string;
}

/**
 * Options for bundling executors
 */
export interface BundleExecutorsOptions {
  /** Executor file loading configuration */
  config: FileLoadConfig;
  /** Start context for workflow/job transformations */
  startContext?: StartContext;
  /** Additional files to bundle (e.g., plugin-generated executors) */
  additionalFiles?: string[];
  /** Optional bundle cache for skipping unchanged builds */
  cache?: BundleCache;
  /** Whether to enable inline sourcemaps */
  inlineSourcemap?: boolean;
  /** Controls which console calls are kept in bundled code */
  bundleLogLevel?: LogLevel;
  /** Directory the config's file patterns are resolved against */
  baseDir: string;
  /** Optional tsconfig lookup cache shared across bundles in this CLI run */
  tsconfigCache?: TsconfigLookupCache;
}

/**
 * Bundle executors from the specified configuration
 *
 * This function:
 * 1. Creates an in-memory entry module that extracts operation.body
 * 2. Bundles in a single step with tree-shaking
 * @param options - Bundle executor options
 * @returns Map of executor name to bundled code
 */
export async function bundleExecutors(
  options: BundleExecutorsOptions,
): Promise<Map<string, string>> {
  const bundledCode = new Map<string, string>();
  const {
    config,
    startContext,
    additionalFiles = [],
    cache,
    inlineSourcemap,
    bundleLogLevel = "DEBUG",
    baseDir,
    tsconfigCache,
  } = options;
  const configFiles = loadFilesWithIgnores(config, baseDir);
  const files = [...configFiles, ...additionalFiles];
  if (files.length === 0) {
    logger.warn(`No executor files found for patterns: ${config.files.join(", ")}`);
    return bundledCode;
  }

  logger.newline();
  logger.log(
    `Bundling ${styles.highlight(files.length.toString())} files for ${styles.info('"executor"')}`,
  );

  // Load all executors and filter to function/jobFunction only
  const executors: ExecutorInfo[] = [];
  for (const file of files) {
    const executor = await loadExecutor(file);
    if (!executor) {
      logger.debug(`  Skipping: ${file} (could not be loaded)`);
      continue;
    }

    // Only bundle function and jobFunction executors
    if (!["function", "jobFunction"].includes(executor.operation.kind)) {
      logger.debug(`  Skipping: ${executor.name} (not a function executor)`);
      continue;
    }

    executors.push({
      name: executor.name,
      sourceFile: file,
    });
  }

  if (executors.length === 0) {
    logger.debug("  No function executors to bundle");
    return bundledCode;
  }

  const tsconfig = await resolveTSConfigWithFallback(baseDir);

  // Process each executor, capped by TAILOR_BUNDLE_CONCURRENCY to bound native
  // memory use (each rolldown.build allocates its own module graph).
  const results = await withBundleConcurrency(executors, (executor) =>
    bundleSingleExecutor(
      executor,
      tsconfig,
      startContext,
      cache,
      inlineSourcemap,
      bundleLogLevel,
      tsconfigCache,
    ),
  );

  for (const [name, code] of results) {
    bundledCode.set(name, code);
  }

  logger.log(`${styles.success("Bundled")} ${styles.info('"executor"')}`);

  return bundledCode;
}

async function bundleSingleExecutor(
  executor: ExecutorInfo,
  tsconfig: string | undefined,
  startContext?: StartContext,
  cache?: BundleCache,
  inlineSourcemap?: boolean,
  bundleLogLevel: LogLevel = "DEBUG",
  tsconfigCache?: TsconfigLookupCache,
): Promise<[string, string]> {
  const serializedStartContext = serializeStartContext(startContext);

  const contextHash = computeBundlerContextHash({
    sourceFile: executor.sourceFile,
    extraContext: serializedStartContext,
    tsconfig,
    inlineSourcemap,
    bundleLogLevel,
  });

  const code = await withCache({
    cache,
    kind: "executor",
    name: executor.name,
    sourceFile: executor.sourceFile,
    contextHash,
    async build(cachePlugins, trackDependency) {
      const absoluteSourcePath = path.resolve(executor.sourceFile);

      const entryContent = ml /* js */ `
        import _internalExecutor from "${absoluteSourcePath}";

        const __executor_function = async (args) => {
          const invoker = ${INVOKER_EXPR};
          return _internalExecutor.operation.body({ ...args, invoker });
        };

        export { __executor_function as main };
      `;
      const entry = createVirtualEntry(
        `executor:${executor.name}`,
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

  return [executor.name, code];
}
