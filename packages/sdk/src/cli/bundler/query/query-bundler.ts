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

function createSqlEntry(): string {
  return ml /* ts */ `
    import { Kysely, sql, TailordbDialect } from "@tailor-platform/sdk/kysely";

    type QueryInput = {
      namespace: string;
      queries: string[];
    };

    function getDB(namespace: string) {
      const client = new tailordb.Client({ namespace });
      return new Kysely<Record<string, Record<string, unknown>>>({
        dialect: new TailordbDialect(client),
      });
    }

    export async function main(input: QueryInput) {
      const db = getDB(input.namespace);
      const results = [];
      for (const query of input.queries) {
        const result = await sql.raw(query).execute(db);
        const rows = result.rows ?? [];
        results.push({ rows, rowCount: rows.length });
      }
      if (results.length === 1) {
        return results[0];
      }
      return results;
    }
  `;
}

/**
 * Bundle the SQL query executor script for TestExecScript.
 * @param baseDir - Directory to resolve the bundler's tsconfig against
 * @returns Bundled code
 */
export async function bundleQueryScript(baseDir: string): Promise<string> {
  const outputDir = path.resolve(getDistDir(), "query");
  fs.mkdirSync(outputDir, { recursive: true });

  const entryPath = path.join(outputDir, "query_sql.entry.ts");
  fs.writeFileSync(entryPath, createSqlEntry());

  const tsconfig = await resolveTSConfigWithFallback(baseDir);

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
