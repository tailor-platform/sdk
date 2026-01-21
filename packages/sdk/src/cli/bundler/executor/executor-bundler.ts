import * as fs from "node:fs";
import ml from "multiline-ts";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { loadFilesWithIgnores, type FileLoadConfig } from "@/cli/application/file-loader";
import { enableInlineSourcemap } from "@/cli/bundler/inline-sourcemap";
import { logger, styles } from "@/cli/utils/logger";
import { getDistDir } from "@/configure/config";
import { createTriggerTransformPlugin, type TriggerContext } from "../trigger-context";
import { loadExecutor } from "./loader";

interface ExecutorInfo {
  name: string;
  sourceFile: string;
}

/**
 * Bundle executors from the specified configuration
 *
 * This function:
 * 1. Creates entry file that extracts operation.body
 * 2. Bundles in a single step with tree-shaking
 * @param config - Executor file loading configuration
 * @param triggerContext - Trigger context for workflow/job transformations
 * @returns Promise that resolves when bundling completes
 */
export async function bundleExecutors(
  config: FileLoadConfig,
  triggerContext?: TriggerContext,
): Promise<void> {
  const files = loadFilesWithIgnores(config);
  if (files.length === 0) {
    logger.warn(`No executor files found for patterns: ${config.files?.join(", ") ?? "(none)"}`);
    return;
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
    return;
  }

  const outputDir = path.resolve(getDistDir(), "executors");

  fs.mkdirSync(outputDir, { recursive: true });

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  // Process each executor
  await Promise.all(
    executors.map((executor) =>
      bundleSingleExecutor(executor, outputDir, tsconfig, triggerContext),
    ),
  );

  logger.log(`${styles.success("Bundled")} ${styles.info('"executor"')}`);
}

async function bundleSingleExecutor(
  executor: ExecutorInfo,
  outputDir: string,
  tsconfig: string | undefined,
  triggerContext?: TriggerContext,
): Promise<void> {
  // Step 1: Create entry file that imports and extracts operation.body
  const entryPath = path.join(outputDir, `${executor.name}.entry.js`);
  const absoluteSourcePath = path.resolve(executor.sourceFile);

  const entryContent = ml /* js */ `
    import _internalExecutor from "${absoluteSourcePath}";

    const __executor_function = _internalExecutor.operation.body;

    export { __executor_function as main };
  `;
  fs.writeFileSync(entryPath, entryContent);

  // Step 2: Bundle with tree-shaking
  const outputPath = path.join(outputDir, `${executor.name}.js`);

  const triggerPlugin = createTriggerTransformPlugin(triggerContext);
  const plugins: rolldown.Plugin[] = triggerPlugin ? [triggerPlugin] : [];

  await rolldown.build(
    rolldown.defineConfig({
      input: entryPath,
      output: {
        file: outputPath,
        format: "esm",
        sourcemap: enableInlineSourcemap ? "inline" : true,
        minify: enableInlineSourcemap
          ? {
              mangle: {
                keepNames: true,
              },
            }
          : true,
        inlineDynamicImports: true,
      },
      tsconfig,
      plugins,
      treeshake: {
        moduleSideEffects: false,
        annotations: true,
        unknownGlobalSideEffects: false,
      },
      logLevel: "silent",
    }) as rolldown.BuildOptions,
  );
}
