/**
 * Migration script bundler for TailorDB migrations
 *
 * Bundles migration scripts to be executed via TestExecScript API
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import ml from "multiline-ts";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { getDistDir } from "@/cli/utils/dist-dir";
import { logger } from "@/cli/utils/logger";

export interface MigrationBundleResult {
  namespace: string;
  migrationNumber: number;
  bundledCode: string;
}

const REQUIRED_PACKAGES = ["kysely", "@tailor-platform/function-kysely-tailordb"] as const;

let dependencyCheckDone = false;

/**
 * Check if required packages for migration bundling are installed.
 * Logs a warning if any are missing.
 */
function checkMigrationDependencies(): void {
  if (dependencyCheckDone) return;
  dependencyCheckDone = true;

  const require = createRequire(path.resolve(process.cwd(), "package.json"));
  const missing: string[] = [];

  for (const pkg of REQUIRED_PACKAGES) {
    try {
      require.resolve(pkg);
    } catch {
      missing.push(pkg);
    }
  }

  if (missing.length > 0) {
    logger.warn(
      `Missing optional dependencies for migration bundling: ${missing.join(", ")}. ` +
        `Install them in your project: pnpm add -D ${missing.join(" ")}`,
    );
  }
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
  // Check for required dependencies (only once per session)
  checkMigrationDependencies();

  // Output directory in .tailor-sdk (relative to project root)
  const outputDir = path.resolve(getDistDir(), "migrations");
  fs.mkdirSync(outputDir, { recursive: true });

  // Entry file in output directory (consistent with resolver/executor bundlers)
  const entryPath = path.join(outputDir, `migration_${namespace}_${migrationNumber}.entry.js`);
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

  // Entry file remains in output directory (consistent with resolver/executor bundlers)

  return {
    namespace,
    migrationNumber,
    bundledCode,
  };
}
