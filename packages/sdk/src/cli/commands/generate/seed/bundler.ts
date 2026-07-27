/**
 * Seed script bundler for TailorDB seed data
 *
 * Bundles seed scripts to be executed via TestExecScript API
 */

import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { getDistDir } from "#/cli/shared/dist-dir";
import { platformBundleDefinePlugin } from "#/cli/shared/platform-bundle-plugin";
import ml from "#/utils/multiline";

export type SeedBundleResult = {
  namespace: string;
  bundledCode: string;
  typesIncluded: string[];
};

const BATCH_SIZE = 100;

/**
 * Generate seed script content for server-side execution
 * @param namespace - TailorDB namespace
 * @returns Generated seed script content
 */
function generateSeedScriptContent(namespace: string): string {
  return ml /* ts */ `
    import { Kysely, TailordbDialect } from "@tailor-platform/sdk/kysely";

    type SeedInput = {
      data: Record<string, Record<string, unknown>[]>;
      order: string[];
      selfRefTypes: string[];
      upsert?: boolean;
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
      const upsert = input.upsert === true;

      // Rows must share one key set, which groupByColumns guarantees.
      // TailorDB restricts the ON CONFLICT target to a single column, so "id" is the only key.
      const write = (typeName: string, rows: Record<string, unknown>[]) => {
        const query = db.insertInto(typeName).values(rows);
        if (!upsert) return query;

        const columns = Object.keys(rows[0]).filter((column) => column !== "id");
        if (columns.length === 0) {
          return query.onConflict((oc) => oc.column("id").doNothing());
        }
        return query.onConflict((oc) =>
          oc.column("id").doUpdateSet(
            Object.fromEntries(columns.map((column) => [column, (eb) => eb.ref(\`excluded.\${column}\`)])),
          ),
        );
      };

      // Rows with differing key sets must not share a statement: Kysely fills the
      // missing keys with \`default\`, which an upsert would write over the stored value.
      const groupByColumns = (rows: Record<string, unknown>[]) => {
        if (!upsert) return [rows];
        const groups = new Map<string, Record<string, unknown>[]>();
        for (const row of rows) {
          const key = Object.keys(row).sort().join("\\u0000");
          const group = groups.get(key);
          if (group) group.push(row);
          else groups.set(key, [row]);
        }
        return [...groups.values()];
      };

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
              await write(typeName, [record]).execute();
              processed[typeName] += 1;
            }
            console.log(\`[${namespace}] \${typeName}: \${processed[typeName]}/\${records.length} (one-by-one)\`);
          } else {
            for (const group of groupByColumns(records)) {
              for (let i = 0; i < group.length; i += BATCH_SIZE) {
                const batch = group.slice(i, i + BATCH_SIZE);
                await write(typeName, batch).execute();
                processed[typeName] += batch.length;
                console.log(\`[${namespace}] \${typeName}: \${processed[typeName]}/\${records.length}\`);
              }
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
  // Output directory in .tailor-sdk (relative to project root)
  const outputDir = path.resolve(getDistDir(), "seed");
  fs.mkdirSync(outputDir, { recursive: true });

  // Entry file in output directory
  const entryPath = path.join(outputDir, `seed_${namespace}.entry.ts`);

  // Generate seed script content
  const entryContent = generateSeedScriptContent(namespace);
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

  return {
    namespace,
    bundledCode,
    typesIncluded: typeNames,
  };
}
