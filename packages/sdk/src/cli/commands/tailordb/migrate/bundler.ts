/**
 * Migration script bundler for TailorDB migrations
 *
 * Bundles migration scripts to be executed via TestExecScript API
 */

import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { getDistDir } from "@/cli/shared/dist-dir";
import { platformBundleDefinePlugin } from "@/cli/shared/platform-bundle-plugin";
import ml from "@/utils/multiline";

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
  // Output directory in .tailor-sdk (relative to project root)
  const outputDir = path.resolve(getDistDir(), "migrations");
  fs.mkdirSync(outputDir, { recursive: true });

  // Entry file in output directory (consistent with resolver/executor bundlers)
  const entryPath = path.join(outputDir, `migration_${namespace}_${migrationNumber}.entry.js`);

  const absoluteSourcePath = path.resolve(sourceFile).replace(/\\/g, "/");

  // Create entry file that wraps migration in a transaction
  // getDB function is defined inline to avoid dependency on generated types
  const entryContent = ml /* js */ `
    import { main as _migrationMain } from "${absoluteSourcePath}";
    import { Kysely, TailordbDialect } from "@tailor-platform/sdk/kysely";

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

  // Bundle with tree-shaking (write: false to avoid unnecessary disk I/O)
  const result = await rolldown.build({
    plugins: [platformBundleDefinePlugin],
    input: entryPath,
    write: false,
    output: {
      format: "esm",
      sourcemap: false,
      minify: false,
      codeSplitting: false,
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
  } as rolldown.BuildOptions);

  const bundledCode = result.output[0].code;

  // Entry file remains in output directory (consistent with resolver/executor bundlers)

  return {
    namespace,
    migrationNumber,
    bundledCode,
  };
}
