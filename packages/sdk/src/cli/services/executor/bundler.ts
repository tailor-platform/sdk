import { loadFilesWithIgnores, type FileLoadConfig } from "#/cli/services/file-loader";
import { buildFunctionBundle, type FunctionBundleSettings } from "#/cli/services/function-bundle";
import { createStartTransformPlugin } from "#/cli/services/workflow/start-transformer";
import { withBundleConcurrency } from "#/cli/shared/bundle-concurrency";
import { logger, styles } from "#/cli/shared/logger";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";
import { INVOKER_EXPR } from "#/cli/shared/runtime-exprs";
import ml from "#/utils/multiline";
import { loadExecutor } from "./loader";
import type { AllowedRuntimeGlobals } from "#/configure/config/types";

interface ExecutorInfo {
  name: string;
  sourceFile: string;
}

/**
 * Options for bundling executors
 */
export interface BundleExecutorsOptions extends FunctionBundleSettings {
  /** Executor file loading configuration */
  config: FileLoadConfig;
  /** Additional files to bundle (e.g., plugin-generated executors) */
  additionalFiles?: string[];
  /** Directory the config's file patterns are resolved against */
  baseDir: string;
  /** Globals each installed package may reference */
  allowedRuntimeGlobals?: AllowedRuntimeGlobals;
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
  const { config, startContext, additionalFiles = [], baseDir, allowedRuntimeGlobals } = options;
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
  const results = await withBundleConcurrency(executors, async (executor) => {
    const code = await buildFunctionBundle({
      ...options,
      kind: "executor",
      name: executor.name,
      sourceFile: executor.sourceFile,
      tsconfig,
      runtimeGlobals: { label: `Executor "${executor.name}"`, allowed: allowedRuntimeGlobals },
      createTransformPlugin: () => createStartTransformPlugin(startContext),
      entry: (absoluteSourcePath) => ml /* js */ `
        import _internalExecutor from "${absoluteSourcePath}";

        const __executor_function = async (args) => {
          const invoker = ${INVOKER_EXPR};
          return _internalExecutor.operation.body({ ...args, invoker });
        };

        export { __executor_function as main };
      `,
    });
    return [executor.name, code] as const;
  });

  for (const [name, code] of results) {
    bundledCode.set(name, code);
  }

  logger.log(`${styles.success("Bundled")} ${styles.info('"executor"')}`);

  return bundledCode;
}
