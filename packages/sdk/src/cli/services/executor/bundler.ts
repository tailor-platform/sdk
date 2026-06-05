import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { computeBundlerContextHash, withCache, type BundleCache } from "@/cli/cache/bundle-cache";
import { loadFilesWithIgnores, type FileLoadConfig } from "@/cli/services/file-loader";
import { removeStaleEntryFiles } from "@/cli/services/stale-cleanup";
import { withBundleConcurrency } from "@/cli/shared/bundle-concurrency";
import { createFunctionTreeshakeOptions } from "@/cli/shared/bundle-log-level";
import { getDistDir } from "@/cli/shared/dist-dir";
import { logger, styles } from "@/cli/shared/logger";
import { INVOKER_EXPR } from "@/cli/shared/runtime-exprs";
import {
  createTriggerTransformPlugin,
  serializeTriggerContext,
  type TriggerContext,
} from "@/cli/shared/trigger-context";
import ml from "@/utils/multiline";
import { loadExecutor } from "./loader";
import type { LogLevel } from "@/types/app-config";

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
  /** Trigger context for workflow/job transformations */
  triggerContext?: TriggerContext;
  /** Additional files to bundle (e.g., plugin-generated executors) */
  additionalFiles?: string[];
  /** Optional bundle cache for skipping unchanged builds */
  cache?: BundleCache;
  /** Whether to enable inline sourcemaps */
  inlineSourcemap?: boolean;
  /** Controls which console calls are kept in bundled code */
  bundleLogLevel?: LogLevel;
}

/**
 * Bundle executors from the specified configuration
 *
 * This function:
 * 1. Creates entry file that extracts operation.body
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
    triggerContext,
    additionalFiles = [],
    cache,
    inlineSourcemap,
    bundleLogLevel = "DEBUG",
  } = options;
  const configFiles = loadFilesWithIgnores(config);
  const files = [...configFiles, ...additionalFiles];
  if (files.length === 0) {
    logger.warn(`No executor files found for patterns: ${config.files?.join(", ") ?? "(none)"}`);
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

  const outputDir = path.resolve(getDistDir(), "executors");

  fs.mkdirSync(outputDir, { recursive: true });

  // Clean stale entry files from previous builds.
  // Must complete before Promise.all below; parallel processing
  // would require separate output directories.
  await removeStaleEntryFiles(outputDir);

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  // Process each executor, capped by TAILOR_BUNDLE_CONCURRENCY to bound native
  // memory use (each rolldown.build allocates its own module graph).
  const results = await withBundleConcurrency(executors, (executor) =>
    bundleSingleExecutor(
      executor,
      outputDir,
      tsconfig,
      triggerContext,
      cache,
      inlineSourcemap,
      bundleLogLevel,
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
  outputDir: string,
  tsconfig: string | undefined,
  triggerContext?: TriggerContext,
  cache?: BundleCache,
  inlineSourcemap?: boolean,
  bundleLogLevel: LogLevel = "DEBUG",
): Promise<[string, string]> {
  const serializedTriggerContext = serializeTriggerContext(triggerContext);

  const contextHash = computeBundlerContextHash({
    sourceFile: executor.sourceFile,
    serializedTriggerContext,
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
    async build(cachePlugins) {
      // Step 1: Create entry file that imports and extracts operation.body
      const entryPath = path.join(outputDir, `${executor.name}.entry.js`);
      const absoluteSourcePath = path.resolve(executor.sourceFile);

      const entryContent = ml /* js */ `
        import _internalExecutor from "${absoluteSourcePath}";

        const __executor_function = async (args) => {
          const invoker = ${INVOKER_EXPR};
          return _internalExecutor.operation.body({ ...args, invoker });
        };

        export { __executor_function as main };
      `;
      fs.writeFileSync(entryPath, entryContent);

      // Step 2: Bundle with tree-shaking (write: false to avoid unnecessary disk I/O)
      const triggerPlugin = createTriggerTransformPlugin(triggerContext);
      const plugins: rolldown.Plugin[] = triggerPlugin ? [triggerPlugin] : [];
      plugins.push(...cachePlugins);

      const result = await rolldown.build({
        input: entryPath,
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
        treeshake: createFunctionTreeshakeOptions(bundleLogLevel),
        logLevel: "silent",
      } as rolldown.BuildOptions);

      return result.output[0].code;
    },
  });

  return [executor.name, code];
}
