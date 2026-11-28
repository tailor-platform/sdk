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
import { createPlatformBundleDefinePlugin } from "#/cli/shared/platform-bundle-plugin";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";
import { createTsconfigPathsPlugin } from "#/cli/shared/tsconfig-paths-plugin";
import { createGeneratedEntryResolverPlugin } from "#/cli/shared/virtual-entry";
import ml from "#/utils/multiline";
import type { EffectiveDateDefault } from "#/runtime/types";
import type { ColumnTypeOptions } from "#/utils/field-column-type";

async function buildEntry(
  entryPath: string,
  entryContent: string,
  projectDir: string,
  dateDefault: EffectiveDateDefault,
) {
  fs.writeFileSync(entryPath, entryContent);
  const tsconfig = await resolveTSConfigWithFallback(projectDir);

  // Bundle with tree-shaking (write: false to avoid unnecessary disk I/O)
  const bundleLog = createBundleLog({ tsconfig });
  const result = await rolldown.build({
    plugins: [
      createGeneratedEntryResolverPlugin(entryPath, projectDir),
      createTsconfigPathsPlugin(),
      createPlatformBundleDefinePlugin(undefined, dateDefault),
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

/**
 * The imports and `getDB` definition a migration entry module starts with. Without
 * `decimal`, `getDB` builds the client by hand; with it, `createGetDB` builds the client
 * that reads and writes `Decimal`.
 * @param columnTypes - Which opt-in column representations the migration's `db.ts` uses
 * @returns Source of the imports and of `getDB`
 */
function migrationKyselySource(columnTypes: ColumnTypeOptions): { imports: string; getDB: string } {
  const temporal = JSON.stringify(columnTypes.temporal === true);
  if (columnTypes.decimal !== true) {
    return {
      imports: 'import { Kysely, TailordbDialect } from "@tailor-platform/sdk/kysely";',
      getDB: [
        "function getDB(namespace) {",
        `  const client = new tailordb.Client({ namespace, temporal: ${temporal} });`,
        "  return new Kysely({",
        "    dialect: new TailordbDialect(client),",
        "  });",
        "}",
      ].join("\n"),
    };
  }
  return {
    imports: [
      'import { createGetDB } from "@tailor-platform/sdk/kysely";',
      'import { Decimal } from "@tailor-platform/sdk/runtime";',
    ].join("\n"),
    getDB: `const getDB = createGetDB({ temporal: ${temporal}, decimal: Decimal });`,
  };
}

/** **Beta:** This API may change in future releases. */
export interface MigrationBundleResult {
  namespace: string;
  migrationNumber: number;
  bundledCode: string;
}

/**
 * Bundle a single migration script
 *
 * **Beta:** This API may change in future releases.
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
 * @param columnTypes - Which opt-in column representations, such as Temporal or Decimal, the script's
 * `db.ts` was generated with; the client this script runs against matches them. Defaults to none.
 * @param dateDefault - Representation applied to `t` date fields that omit `as`, as recorded in the
 * migration's `diff.json` when it was generated. Defaults to `"legacy"`.
 * @returns {Promise<MigrationBundleResult>} Bundled migration result
 */
export async function bundleMigrationScript(
  sourceFile: string,
  namespace: string,
  migrationNumber: number,
  env: Record<string, string | number | boolean> = {},
  baseDir?: string,
  columnTypes: ColumnTypeOptions = {},
  dateDefault: EffectiveDateDefault = "legacy",
): Promise<MigrationBundleResult> {
  // Output directory in .tailor (relative to project root)
  const outputDir = path.resolve(getDistDir(), "migrations");
  fs.mkdirSync(outputDir, { recursive: true });

  // Entry file in output directory (consistent with resolver/executor bundlers)
  const entryPath = path.join(outputDir, `migration_${namespace}_${migrationNumber}.entry.js`);

  const absoluteSourcePath = path.resolve(sourceFile).replace(/\\/g, "/");

  // Create entry file that wraps migration in a transaction
  // getDB function is defined inline to avoid dependency on generated types
  const kysely = migrationKyselySource(columnTypes);
  const entryContent = ml /* js */ `
    import { main as _migrationMain } from "${absoluteSourcePath}";
    ${kysely.imports}

    ${kysely.getDB}

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
    dateDefault,
  );

  return {
    namespace,
    migrationNumber,
    bundledCode,
  };
}

export interface BundleSingleStepMigrationOptions extends ColumnTypeOptions {
  /** Path to the migration script exporting `steps`. */
  sourceFile: string;
  namespace: string;
  migrationNumber: number;
  /** Environment variables to inject into the step's context. */
  env: Record<string, string | number | boolean>;
  /** The only step of the script. */
  step: string;
  /** Directory to resolve the bundler's tsconfig against; defaults to the script's directory. */
  baseDir?: string | undefined;
  /** Representation applied to `t` date fields that omit `as`, as recorded in `diff.json`. Defaults to `"legacy"`. */
  dateDefault?: EffectiveDateDefault | undefined;
}

/**
 * Bundle a migration script whose `steps` holds a single step so that it runs
 * like a `main` script: the entry's `main` runs the step in one transaction,
 * without starting a runner job.
 * @param options - Bundle options
 * @returns Bundled migration result
 */
export async function bundleSingleStepMigration(
  options: BundleSingleStepMigrationOptions,
): Promise<MigrationBundleResult> {
  const { sourceFile, namespace, migrationNumber, env, step, dateDefault = "legacy" } = options;
  const outputDir = path.resolve(getDistDir(), "migrations");
  fs.mkdirSync(outputDir, { recursive: true });
  const entryPath = path.join(
    outputDir,
    `migration_${namespace}_${migrationNumber}.single-step.entry.js`,
  );
  const absoluteSourcePath = path.resolve(sourceFile).replace(/\\/g, "/");

  const kysely = migrationKyselySource(options);
  const entryContent = ml /* js */ `
    import { steps as _migrationSteps } from ${JSON.stringify(absoluteSourcePath)};
    ${kysely.imports}

    ${kysely.getDB}

    export async function main(input) {
      const env = ${JSON.stringify(env)};
      const db = getDB(${JSON.stringify(namespace)});
      await db.transaction().execute(async (trx) => {
        await _migrationSteps[${JSON.stringify(step)}].run(trx, { env });
      });
      return { success: true };
    }
  `;
  const bundledCode = await buildEntry(
    entryPath,
    entryContent,
    options.baseDir ?? path.dirname(absoluteSourcePath),
    dateDefault,
  );
  return { namespace, migrationNumber, bundledCode };
}

export interface BundleMigrationStepsOptions extends ColumnTypeOptions {
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
  /** Steps the runner reports as skipped instead of running; they still occupy their place in `order`. */
  skipSteps?: readonly string[] | undefined;
  /** Directory to resolve the bundler's tsconfig against; defaults to the script's directory. */
  baseDir?: string | undefined;
  /** Representation applied to `t` date fields that omit `as`, as recorded in the migration's `diff.json`. */
  dateDefault?: EffectiveDateDefault | undefined;
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
  const {
    sourceFile,
    namespace,
    migrationNumber,
    env,
    order,
    runnerJobFunctionName,
    skipSteps = [],
    dateDefault = "legacy",
  } = options;
  const outputDir = path.resolve(getDistDir(), "migrations");
  fs.mkdirSync(outputDir, { recursive: true });
  const entryPath = path.join(
    outputDir,
    `migration_${namespace}_${migrationNumber}.steps.entry.js`,
  );
  const absoluteSourcePath = path.resolve(sourceFile).replace(/\\/g, "/");

  const kysely = migrationKyselySource(options);
  const entryContent = ml /* js */ `
    import { steps as _migrationSteps } from ${JSON.stringify(absoluteSourcePath)};
    ${kysely.imports}

    const STEP_ORDER = ${JSON.stringify(order)};
    const RUNNER_JOB_FUNCTION = ${JSON.stringify(runnerJobFunctionName)};
    const SKIP_STEPS = ${JSON.stringify(skipSteps)};

    ${kysely.getDB}

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
      if (SKIP_STEPS.includes(step)) {
        return { step, skipped: true };
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
    dateDefault,
  );
  return { namespace, migrationNumber, bundledCode };
}
