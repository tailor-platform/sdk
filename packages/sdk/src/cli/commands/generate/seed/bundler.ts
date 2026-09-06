/**
 * Seed script bundler for TailorDB seed data
 *
 * Bundles seed scripts for server-side execution
 */

import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { createBundleLog } from "#/cli/shared/bundle-log";
import { getDistDir } from "#/cli/shared/dist-dir";
import { platformBundleDefinePlugin } from "#/cli/shared/platform-bundle-plugin";
import { createTsconfigPathsPlugin } from "#/cli/shared/tsconfig-paths-plugin";
import { createGeneratedEntryResolverPlugin } from "#/cli/shared/virtual-entry";
import ml from "#/utils/multiline";

export type SeedBundleResult = {
  namespace: string;
  bundledCode: string;
  typesIncluded: string[];
};

/**
 * Result of bundling a seed dump script.
 */
export type SeedDumpBundleResult = {
  namespace: string;
  bundledCode: string;
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
      processed: Record<string, { inserted: number; updated: number; skipped: number }>;
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
      const processed: Record<
        string,
        { inserted: number; updated: number; skipped: number }
      > = {};
      const errors: string[] = [];
      const BATCH_SIZE = ${String(BATCH_SIZE)};
      const upsert = input.upsert === true;

      for (const tableName of input.order) {
        const records = input.data[tableName];
        if (!records || records.length === 0) {
          console.log(\`[${namespace}] \${tableName}: skipped (no data)\`);
          continue;
        }

        processed[tableName] = { inserted: 0, updated: 0, skipped: 0 };
        const hasSelfRef = (input.selfRefTypes || []).includes(tableName);

        try {
          let recordsToInsert = records;
          let recordsToUpdate: Record<string, unknown>[] = [];
          if (upsert) {
            const existing = await db
              .selectFrom(tableName)
              .select("id")
              .where(
                "id",
                "in",
                records.map((record) => record.id),
              )
              .execute();
            const existingIds = new Set(existing.map((record) => record.id));
            recordsToInsert = records.filter((record) => !existingIds.has(record.id));
            recordsToUpdate = records.filter((record) => existingIds.has(record.id));
          }

          if (hasSelfRef) {
            // Insert one-by-one to respect self-referencing foreign key order
            for (const record of recordsToInsert) {
              await db.insertInto(tableName).values(record).execute();
              processed[tableName].inserted += 1;
            }
            if (!upsert) {
              console.log(
                \`[${namespace}] \${tableName}: \${processed[tableName].inserted}/\${records.length} (one-by-one)\`,
              );
            }
          } else {
            for (let i = 0; i < recordsToInsert.length; i += BATCH_SIZE) {
              const batch = recordsToInsert.slice(i, i + BATCH_SIZE);
              await db.insertInto(tableName).values(batch).execute();
              processed[tableName].inserted += batch.length;
              if (!upsert) {
                console.log(
                  \`[${namespace}] \${tableName}: \${processed[tableName].inserted}/\${records.length}\`,
                );
              }
            }
          }

          for (const record of recordsToUpdate) {
            const { id, ...values } = record;
            if (Object.keys(values).length === 0) {
              processed[tableName].skipped += 1;
              continue;
            }
            await db.updateTable(tableName).set(values).where("id", "=", id).execute();
            processed[tableName].updated += 1;
          }

          const counts = processed[tableName];
          if (upsert) {
            const skipped = counts.skipped > 0 ? \`, \${counts.skipped} skipped\` : "";
            console.log(
              \`[${namespace}] \${tableName}: \${counts.inserted} inserted, \${counts.updated} updated\${skipped}\`,
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(\`\${tableName}: \${message}\`);
          console.error(\`[${namespace}] \${tableName}: failed - \${message}\`);
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
 * Generate seed dump script content for server-side execution
 * @param namespace - TailorDB namespace
 * @returns Generated seed dump script content
 */
function generateSeedDumpScriptContent(namespace: string): string {
  return ml /* ts */ `
    import { Kysely, TailordbDialect } from "@tailor-platform/sdk/kysely";

    type DumpInput = {
      table: string;
      limit: number;
      after?: string | null;
    };

    type DumpResult = {
      success: boolean;
      rows: Record<string, unknown>[];
      cursor: string | null;
      errors: string[];
    };

    function getDB(namespace: string) {
      const client = new tailordb.Client({ namespace });
      return new Kysely<Record<string, Record<string, unknown>>>({
        dialect: new TailordbDialect(client),
      });
    }

    export async function main(input: DumpInput): Promise<DumpResult> {
      const db = getDB("${namespace}");

      try {
        let query = db.selectFrom(input.table).selectAll().orderBy("id", "asc").limit(input.limit);
        if (input.after !== null && input.after !== undefined) {
          query = query.where("id", ">", input.after);
        }
        const rows = (await query.execute()) as Record<string, unknown>[];

        // A full page may have more rows behind it; page again from the last id.
        const lastRow = rows.length === input.limit ? rows[rows.length - 1] : undefined;
        if (lastRow && typeof lastRow.id !== "string") {
          // Paging past this row is impossible, and reporting no cursor would
          // silently drop every row behind it.
          // Left unprefixed with the table name: the caller (dump.ts) already
          // prefixes every error it throws with the table.
          const message = "cannot page rows whose id is not a string";
          return { success: false, rows: [], cursor: null, errors: [message] };
        }
        const lastId = lastRow ? (lastRow.id as string) : null;

        console.log(\`[${namespace}] \${input.table}: \${rows.length} rows read\`);

        return { success: true, rows, cursor: lastId, errors: [] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(\`[${namespace}] \${input.table}: failed - \${message}\`);
        // Left unprefixed with the table name: the caller (dump.ts) already
        // prefixes every error it throws with the table.
        return { success: false, rows: [], cursor: null, errors: [message] };
      }
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
 * 4. Exports main() as the server-side entry point
 * @param namespace - TailorDB namespace
 * @param tableNames - List of table names to include in the seed
 * @param baseDir - Directory whose dependencies and tsconfig the generated entry uses
 * @returns Bundled seed script result
 */
export async function bundleSeedScript(
  namespace: string,
  tableNames: string[],
  baseDir: string = process.cwd(),
): Promise<SeedBundleResult> {
  const bundledCode = await bundleGeneratedEntry({
    entryFileName: `seed_${namespace}.entry.ts`,
    entryContent: generateSeedScriptContent(namespace),
    baseDir,
  });

  return {
    namespace,
    bundledCode,
    typesIncluded: tableNames,
  };
}

/**
 * Bundle a seed dump script for server-side execution
 *
 * The read-only counterpart of the seed script: it selects one page of rows
 * from a single table ordered by id, so a caller can page through a table with
 * a keyset cursor instead of holding it all in one message.
 * @param namespace - TailorDB namespace
 * @param baseDir - Directory whose dependencies and tsconfig the generated entry uses
 * @returns Bundled seed dump script result
 */
export async function bundleSeedDumpScript(
  namespace: string,
  baseDir: string = process.cwd(),
): Promise<SeedDumpBundleResult> {
  const bundledCode = await bundleGeneratedEntry({
    entryFileName: `seed_dump_${namespace}.entry.ts`,
    entryContent: generateSeedDumpScriptContent(namespace),
    baseDir,
  });

  return { namespace, bundledCode };
}

interface BundleGeneratedEntryParams {
  /** File name the generated entry is written under the seed dist directory */
  entryFileName: string;
  /** Source of the generated entry */
  entryContent: string;
  /** Directory whose dependencies and tsconfig the generated entry uses */
  baseDir: string;
}

/**
 * Write a generated server-side entry and bundle it for script execution.
 * @param params - Entry file name, its source, and the base directory
 * @returns Bundled script code
 */
async function bundleGeneratedEntry(params: BundleGeneratedEntryParams): Promise<string> {
  const { entryFileName, entryContent, baseDir } = params;

  // Output directory in .tailor (relative to project root)
  const outputDir = path.resolve(getDistDir(), "seed");
  fs.mkdirSync(outputDir, { recursive: true });

  const entryPath = path.join(outputDir, entryFileName);
  fs.writeFileSync(entryPath, entryContent);

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig(baseDir);
  } catch {
    tsconfig = undefined;
  }

  // Bundle with tree-shaking (write: false to avoid unnecessary disk I/O)
  const bundleLog = createBundleLog({ tsconfig });
  const result = await rolldown.build({
    plugins: [
      createGeneratedEntryResolverPlugin(entryPath, baseDir),
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

  return result.output[0].code;
}
