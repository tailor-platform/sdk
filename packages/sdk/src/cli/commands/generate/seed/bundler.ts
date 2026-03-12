/**
 * Seed script bundler for TailorDB seed data
 *
 * Bundles seed scripts to be executed via TestExecScript API
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import ml from "multiline-ts";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { getDistDir } from "@/cli/shared/dist-dir";
import { logger } from "@/cli/shared/logger";

export type SeedBundleResult = {
  namespace: string;
  bundledCode: string;
  typesIncluded: string[];
};

const REQUIRED_PACKAGES = ["kysely", "@tailor-platform/function-kysely-tailordb"] as const;

let dependencyCheckDone = false;

/**
 * Check if required packages for seed bundling are installed.
 * Logs a warning if any are missing.
 */
function checkSeedDependencies(): void {
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
      `Missing optional dependencies for seed bundling: ${missing.join(", ")}. ` +
        `Install them in your project: pnpm add -D ${missing.join(" ")}`,
    );
  }
}

const BATCH_SIZE = 100;

/**
 * Generate seed script content for server-side execution
 * @param namespace - TailorDB namespace
 * @returns Generated seed script content
 */
function generateSeedScriptContent(namespace: string): string {
  return ml /* ts */ `
    import { Kysely } from "kysely";
    import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";

    type SeedInput = {
      data: Record<string, Record<string, unknown>[]>;
      order: string[];
      selfRefTypes: string[];
    };

    type SeedResult = {
      success: boolean;
      processed: Record<string, number>;
      errors: string[];
    };

    function getDB(namespace: string) {
      const client = new tailordb.Client({ namespace });
      return new Kysely<Record<string, Record<string, unknown>>>({
        dialect: new TailordbDialect(client),
      });
    }

    export async function main(input: SeedInput): Promise<SeedResult> {
      const db = getDB("${namespace}");
      const processed: Record<string, number> = {};
      const errors: string[] = [];
      const BATCH_SIZE = ${String(BATCH_SIZE)};

      for (const typeName of input.order) {
        const records = input.data[typeName];
        if (!records || records.length === 0) {
          console.log(\`[${namespace}] \${typeName}: skipped (no data)\`);
          continue;
        }

        processed[typeName] = 0;
        const hasSelfRef = (input.selfRefTypes || []).includes(typeName);

        try {
          if (hasSelfRef) {
            // Insert one-by-one to respect self-referencing foreign key order
            for (const record of records) {
              await db.insertInto(typeName).values(record).execute();
              processed[typeName] += 1;
            }
            console.log(\`[${namespace}] \${typeName}: \${processed[typeName]}/\${records.length} (one-by-one)\`);
          } else {
            for (let i = 0; i < records.length; i += BATCH_SIZE) {
              const batch = records.slice(i, i + BATCH_SIZE);
              await db.insertInto(typeName).values(batch).execute();
              processed[typeName] += batch.length;
              console.log(\`[${namespace}] \${typeName}: \${processed[typeName]}/\${records.length}\`);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(\`\${typeName}: \${message}\`);
          console.error(\`[${namespace}] \${typeName}: failed - \${message}\`);
        }
      }

      return {
        success: errors.length === 0,
        processed,
        errors,
      };
    }
  `;
}

/**
 * Bundle a seed script for server-side execution
 *
 * Creates an entry that:
 * 1. Defines getDB() function inline
 * 2. Processes data in batches using Kysely
 * 3. Reports progress via console.log
 * 4. Exports as main() for TestExecScript
 * @param namespace - TailorDB namespace
 * @param typeNames - List of type names to include in the seed
 * @returns Bundled seed script result
 */
export async function bundleSeedScript(
  namespace: string,
  typeNames: string[],
): Promise<SeedBundleResult> {
  // Check for required dependencies (only once per session)
  checkSeedDependencies();

  // Output directory in .tailor-sdk (relative to project root)
  const outputDir = path.resolve(getDistDir(), "seed");
  fs.mkdirSync(outputDir, { recursive: true });

  // Entry file in output directory
  const entryPath = path.join(outputDir, `seed_${namespace}.entry.ts`);
  const outputPath = path.join(outputDir, `seed_${namespace}.js`);

  // Generate seed script content
  const entryContent = generateSeedScriptContent(namespace);
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
    }) as rolldown.BuildOptions,
  );

  // Read bundled output
  const bundledCode = fs.readFileSync(outputPath, "utf-8");

  return {
    namespace,
    bundledCode,
    typesIncluded: typeNames,
  };
}
