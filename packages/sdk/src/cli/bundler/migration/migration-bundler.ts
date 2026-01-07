/**
 * Migration script bundler for TailorDB migrations
 *
 * Bundles migration scripts to be executed via TestExecScript API
 */

import * as fs from "node:fs";
import * as path from "node:path";
import ml from "multiline-ts";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { enableInlineSourcemap } from "@/cli/bundler/inline-sourcemap";
import { getDistDir } from "@/configure/config";

export interface MigrationBundleResult {
  namespace: string;
  migrationNumber: number;
  bundledCode: string;
}

/**
 * Bundle a single migration script
 *
 * Creates an entry that:
 * 1. Imports the migration script's main function
 * 2. Wraps it in a transaction using getDB()
 * 3. Exports as main() for TestExecScript
 * @param {string} sourceFile - Path to the migration script file
 * @param {string} namespace - TailorDB namespace
 * @param {number} migrationNumber - Migration number
 * @param {string} generatedTailorDBPath - Path to generated tailordb types file
 * @returns {Promise<MigrationBundleResult>} Bundled migration result
 */
export async function bundleMigrationScript(
  sourceFile: string,
  namespace: string,
  migrationNumber: number,
  generatedTailorDBPath: string,
): Promise<MigrationBundleResult> {
  const outputDir = path.resolve(getDistDir(), "migrations");
  fs.mkdirSync(outputDir, { recursive: true });

  const entryPath = path.join(outputDir, `migration_${namespace}_${migrationNumber}.entry.js`);
  const outputPath = path.join(outputDir, `migration_${namespace}_${migrationNumber}.js`);

  const absoluteSourcePath = path.resolve(sourceFile).replace(/\\/g, "/");
  const absoluteGeneratedPath = path.resolve(generatedTailorDBPath).replace(/\\/g, "/");

  // Create entry file that wraps migration in a transaction
  const entryContent = ml /* js */ `
    import { main as _migrationMain } from "${absoluteSourcePath}";
    import { getDB } from "${absoluteGeneratedPath}";

    export async function main(input) {
      const db = getDB("${namespace}");
      await db.transaction().execute(async (trx) => {
        await _migrationMain(trx);
      });
      return { success: true };
    }
  `;
  fs.writeFileSync(entryPath, entryContent);

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  // Bundle with tree-shaking
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
      treeshake: {
        moduleSideEffects: false,
        annotations: true,
        unknownGlobalSideEffects: false,
      },
      logLevel: "silent",
    }) as rolldown.BuildOptions,
  );

  // Read bundled output
  const bundledCode = fs.readFileSync(outputPath, "utf-8");

  // Clean up entry file (keep output for debugging if needed)
  fs.unlinkSync(entryPath);

  return {
    namespace,
    migrationNumber,
    bundledCode,
  };
}
