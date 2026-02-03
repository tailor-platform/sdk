import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { enableInlineSourcemap } from "@/cli/bundler/inline-sourcemap";
import { getDistDir } from "@/cli/utils/dist-dir";
import { logger, styles } from "@/cli/utils/logger";
import type { LoadedFunction } from "@/cli/application/function-registry/service";

export interface BundledFunction {
  name: string;
  scriptPath: string;
  contentHash: string;
  sizeBytes: number;
}

/**
 * Bundle function registry files for deployment.
 * @param functions - Array of loaded functions to bundle
 * @returns Array of bundled function metadata
 */
export async function bundleFunctionRegistry(
  functions: ReadonlyArray<LoadedFunction>,
): Promise<BundledFunction[]> {
  if (functions.length === 0) {
    return [];
  }

  logger.newline();
  logger.log(`Bundling ${styles.highlight(functions.length.toString())} function registry files`);

  const outputDir = path.resolve(getDistDir(), "function-registry");
  fs.mkdirSync(outputDir, { recursive: true });

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  const bundledFunctions: BundledFunction[] = [];

  for (const fn of functions) {
    const result = await bundleSingleFunction(fn, outputDir, tsconfig);
    bundledFunctions.push(result);
  }

  logger.log(`${styles.success("Bundled")} ${bundledFunctions.length} function registry files`);
  return bundledFunctions;
}

async function bundleSingleFunction(
  fn: LoadedFunction,
  outputDir: string,
  tsconfig: string | undefined,
): Promise<BundledFunction> {
  const outputPath = path.join(outputDir, `${fn.name}.js`);

  await rolldown.build(
    rolldown.defineConfig({
      input: fn.filePath,
      output: {
        file: outputPath,
        format: "esm",
        sourcemap: enableInlineSourcemap ? "inline" : true,
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

  // Calculate content hash and size using stream (avoid loading entire file into memory)
  const { contentHash, sizeBytes } = await computeFileHashAndSize(outputPath);

  return {
    name: fn.name,
    scriptPath: outputPath,
    contentHash,
    sizeBytes,
  };
}

/**
 * Compute SHA-256 hash and size of a file using stream.
 * This avoids loading the entire file into memory.
 * @param filePath - Path to the file to hash
 * @returns Object containing contentHash and sizeBytes
 */
async function computeFileHashAndSize(
  filePath: string,
): Promise<{ contentHash: string; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    let sizeBytes = 0;

    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk: Buffer | string) => {
      hash.update(chunk);
      sizeBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
    });
    stream.on("end", () => {
      resolve({ contentHash: hash.digest("hex"), sizeBytes });
    });
    stream.on("error", reject);
  });
}
