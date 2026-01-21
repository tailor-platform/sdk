/**
 * Migration script bundler for TailorDB migrations
 *
 * Bundles migration scripts to be executed via TestExecScript API
 */

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import ml from "multiline-ts";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
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
 * 2. Defines getDB() function inline
 * 3. Wraps migration in a transaction using getDB()
 * 4. Exports as main() for TestExecScript
 * @param {string} sourceFile - Path to the migration script file
 * @param {string} namespace - TailorDB namespace
 * @param {number} migrationNumber - Migration number
 * @returns {Promise<MigrationBundleResult>} Bundled migration result
 */
export async function bundleMigrationScript(
  sourceFile: string,
  namespace: string,
  migrationNumber: number,
): Promise<MigrationBundleResult> {
  // Find SDK root directory (where node_modules exists)
  let sdkRoot = path.dirname(fileURLToPath(import.meta.url));
  while (sdkRoot !== path.dirname(sdkRoot)) {
    if (fs.existsSync(path.join(sdkRoot, "node_modules"))) {
      break;
    }
    sdkRoot = path.dirname(sdkRoot);
  }

  // Create entry file in SDK root to ensure node_modules resolution
  const tempEntryDir = path.join(sdkRoot, ".tmp-migrations");
  fs.mkdirSync(tempEntryDir, { recursive: true });
  const entryPath = path.join(tempEntryDir, `migration_${namespace}_${migrationNumber}.entry.js`);

  // Output directory in .tailor-sdk
  const outputDir = path.resolve(getDistDir(), "migrations");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `migration_${namespace}_${migrationNumber}.js`);

  const absoluteSourcePath = path.resolve(sourceFile).replace(/\\/g, "/");

  // Create entry file that wraps migration in a transaction
  // getDB function is defined inline to avoid dependency on generated types
  const entryContent = ml /* js */ `
    import { main as _migrationMain } from "${absoluteSourcePath}";
    import { Kysely } from "kysely";
    import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";

    function getDB(namespace) {
      const client = new tailordb.Client({ namespace });
      return new Kysely({
        dialect: new TailordbDialect(client),
      });
    }

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
        sourcemap: false,
        minify: false,
        inlineDynamicImports: true,
        globals: {
          tailordb: "tailordb",
        },
      },
      external: ["tailordb"],
      resolve: {
        conditionNames: ["node", "import"],
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

  // Clean up entry file and temp directory
  fs.unlinkSync(entryPath);
  try {
    // Remove temp directory if empty
    fs.rmdirSync(tempEntryDir);
  } catch {
    // Directory not empty or other error, ignore
  }

  return {
    namespace,
    migrationNumber,
    bundledCode,
  };
}
