/**
 * Migration script bundler for TailorDB migrations
 *
 * Bundles migration scripts for server-side execution
 */

import * as fs from "node:fs";
import * as path from "pathe";
import * as rolldown from "rolldown";
import { createBundleLog } from "#/cli/shared/bundle-log";
import { getDistDir } from "#/cli/shared/dist-dir";
import { platformBundleDefinePlugin } from "#/cli/shared/platform-bundle-plugin";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";
import { createTsconfigPathsPlugin } from "#/cli/shared/tsconfig-paths-plugin";
import { createGeneratedEntryResolverPlugin } from "#/cli/shared/virtual-entry";
import ml from "#/utils/multiline";

async function buildEntry(entryPath: string, entryContent: string, projectDir: string) {
  fs.writeFileSync(entryPath, entryContent);
  const tsconfig = await resolveTSConfigWithFallback(projectDir);

  // Bundle with tree-shaking (write: false to avoid unnecessary disk I/O)
  const bundleLog = createBundleLog({ tsconfig });
  const result = await rolldown.build({
    plugins: [
      createGeneratedEntryResolverPlugin(entryPath, projectDir),
      createTsconfigPathsPlugin(),
      platformBundleDefinePlugin,
    ],
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
    ...bundleLog.options,
  } as rolldown.BuildOptions);
  bundleLog.assertAllResolved();

  // Entry file remains in output directory (consistent with resolver/executor bundlers)
  return result.output[0].code;
}

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
 * 4. Exports as main() for server-side execution
 * @param {string} sourceFile - Path to the migration script file
 * @param {string} namespace - TailorDB namespace
 * @param {number} migrationNumber - Migration number
 * @param {Record<string, string | number | boolean>} env - Environment variables to inject into the migration context
 * @param {string} [baseDir] - Directory to resolve the bundler's tsconfig against; defaults to the migration script's directory
 * @returns {Promise<MigrationBundleResult>} Bundled migration result
 */
export async function bundleMigrationScript(
  sourceFile: string,
  namespace: string,
  migrationNumber: number,
  env: Record<string, string | number | boolean> = {},
  baseDir?: string,
): Promise<MigrationBundleResult> {
  // Output directory in .tailor (relative to project root)
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
      const env = ${JSON.stringify(env)};
      const db = getDB("${namespace}");
      await db.transaction().execute(async (trx) => {
        await _migrationMain(trx, { env });
      });
      return { success: true };
    }
  `;
  const bundledCode = await buildEntry(
    entryPath,
    entryContent,
    baseDir ?? path.dirname(absoluteSourcePath),
  );

  return {
    namespace,
    migrationNumber,
    bundledCode,
  };
}

export interface BundleMigrationStepsOptions {
  /** Path to the migration script exporting `steps`. */
  sourceFile: string;
  namespace: string;
  migrationNumber: number;
  /** Environment variables to inject into each step's context. */
  env: Record<string, string | number | boolean>;
  /** Step names in execution order, as validated from the script's source. */
  order: readonly string[];
  /** Job function the orchestrator starts once per step. */
  runnerJobFunctionName: string;
  /** Directory to resolve the bundler's tsconfig against; defaults to the script's directory. */
  baseDir?: string;
}

/**
 * Bundle a multi-step migration script.
 *
 * The bundle's `main` plays two roles. Called with `{ step }`, it runs that
 * step in its own transaction. Called without one, it starts the runner job
 * once per step in `order`, so every step commits separately.
 * @param options - Bundle options
 * @returns Bundled migration result
 */
export async function bundleMigrationSteps(
  options: BundleMigrationStepsOptions,
): Promise<MigrationBundleResult> {
  const { sourceFile, namespace, migrationNumber, env, order, runnerJobFunctionName } = options;
  const outputDir = path.resolve(getDistDir(), "migrations");
  fs.mkdirSync(outputDir, { recursive: true });
  const entryPath = path.join(
    outputDir,
    `migration_${namespace}_${migrationNumber}.steps.entry.js`,
  );
  const absoluteSourcePath = path.resolve(sourceFile).replace(/\\/g, "/");

  const entryContent = ml /* js */ `
    import { steps as _migrationSteps } from ${JSON.stringify(absoluteSourcePath)};
    import { Kysely, TailordbDialect } from "@tailor-platform/sdk/kysely";

    const STEP_ORDER = ${JSON.stringify(order)};
    const RUNNER_JOB_FUNCTION = ${JSON.stringify(runnerJobFunctionName)};

    function getDB(namespace) {
      const client = new tailordb.Client({ namespace });
      return new Kysely({
        dialect: new TailordbDialect(client),
      });
    }

    export async function main(input) {
      const step = input && input.step;
      if (step === undefined) {
        for (const name of STEP_ORDER) {
          tailor.workflow.execJobFunction(RUNNER_JOB_FUNCTION, { step: name });
        }
        return { success: true };
      }
      if (!STEP_ORDER.includes(step)) {
        throw new Error(\`Unknown migration step "\${step}"\`);
      }
      const env = ${JSON.stringify(env)};
      const db = getDB(${JSON.stringify(namespace)});
      await db.transaction().execute(async (trx) => {
        await _migrationSteps[step].run(trx, { env });
      });
      return { step };
    }
  `;
  const bundledCode = await buildEntry(
    entryPath,
    entryContent,
    options.baseDir ?? path.dirname(absoluteSourcePath),
  );
  return { namespace, migrationNumber, bundledCode };
}
