import * as fs from "node:fs";
import * as path from "node:path";
import { styleText } from "node:util";
import ml from "multiline-ts";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import {
  loadFilesWithIgnores,
  type FileLoadConfig,
} from "@/cli/application/file-loader";
import { getDistDir } from "@/configure/config";
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
 */
export async function bundleExecutors(config: FileLoadConfig): Promise<void> {
  const files = loadFilesWithIgnores(config);
  if (files.length === 0) {
    throw new Error(
      `No files found matching pattern: ${config.files?.join(", ")}`,
    );
  }

  console.log("");
  console.log(
    "Bundling",
    styleText("cyanBright", files.length.toString()),
    "files for",
    styleText("cyan", '"executor"'),
  );

  // Load all executors and filter to function/jobFunction only
  const executors: ExecutorInfo[] = [];
  for (const file of files) {
    const executor = await loadExecutor(file);
    if (!executor) {
      console.log(
        styleText("dim", `  Skipping: ${file} (could not be loaded)`),
      );
      continue;
    }

    // Only bundle function and jobFunction executors
    if (!["function", "jobFunction"].includes(executor.operation.kind)) {
      console.log(
        styleText(
          "dim",
          `  Skipping: ${executor.name} (not a function executor)`,
        ),
      );
      continue;
    }

    executors.push({
      name: executor.name,
      sourceFile: file,
    });
  }

  if (executors.length === 0) {
    console.log(styleText("dim", "  No function executors to bundle"));
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
      bundleSingleExecutor(executor, outputDir, tsconfig),
    ),
  );

  console.log(styleText("green", "Bundled"), styleText("cyan", '"executor"'));
}

async function bundleSingleExecutor(
  executor: ExecutorInfo,
  outputDir: string,
  tsconfig: string | undefined,
): Promise<void> {
  // Step 1: Create entry file that imports and extracts operation.body
  const entryPath = path.join(outputDir, `${executor.name}.entry.js`);
  const absoluteSourcePath = path
    .resolve(executor.sourceFile)
    .replace(/\\/g, "/");

  const entryContent = ml /* js */ `
    import _internalExecutor from "${absoluteSourcePath}";

    const __executor_function = _internalExecutor.operation.body;

    globalThis.main = __executor_function;
  `;
  fs.writeFileSync(entryPath, entryContent);

  // Step 2: Bundle with tree-shaking
  const outputPath = path.join(outputDir, `${executor.name}.js`);

  await rolldown.build(
    rolldown.defineConfig({
      input: entryPath,
      output: {
        file: outputPath,
        format: "esm",
        sourcemap: true,
        minify: true,
        inlineDynamicImports: true,
      },
      tsconfig,
      treeshake: {
        moduleSideEffects: false,
        annotations: true,
        unknownGlobalSideEffects: false,
      },
      logLevel: "silent",
    }) as rolldown.BuildOptions,
  );
}
