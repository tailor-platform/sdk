import * as fs from "node:fs";
import ml from "multiline-ts";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { getDistDir } from "@/cli/utils/dist-dir";
import type { QueryEngine } from "@/cli/query";

function createSqlEntry(): string {
  return ml /* ts */ `
    import { Kysely, sql } from "@tailor-platform/sdk/kysely";
    import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";

    type QueryInput = {
      namespace: string;
      query: string;
    };

    function getDB(namespace: string) {
      const client = new tailordb.Client({ namespace });
      return new Kysely<Record<string, Record<string, unknown>>>({
        dialect: new TailordbDialect(client),
      });
    }

    export async function main(input: QueryInput) {
      const db = getDB(input.namespace);
      const result = await sql.raw(input.query).execute(db);
      const rows = result.rows ?? [];
      return {
        rows,
        rowCount: rows.length,
      };
    }
  `;
}

function createGqlEntry(): string {
  return ml /* ts */ `
    type QueryInput = {
      endpoint: string;
      accessToken: string;
      query: string;
    };

    export async function main(input: QueryInput) {
      const response = await fetch(input.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: \`Bearer \${input.accessToken}\`,
        },
        body: JSON.stringify({
          query: input.query,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        const message =
          json && typeof json === "object" && "message" in json
            ? String(json.message)
            : \`HTTP \${response.status}\`;
        throw new Error(\`GraphQL request failed: \${message}\`);
      }
      return json;
    }
  `;
}

/**
 * Bundle a query executor script for TestExecScript.
 * @param engine - Query engine type
 * @returns Bundled code
 */
export async function bundleQueryScript(engine: QueryEngine): Promise<string> {
  const outputDir = path.resolve(getDistDir(), "query");
  fs.mkdirSync(outputDir, { recursive: true });

  const entryPath = path.join(outputDir, `query_${engine}.entry.ts`);
  const outputPath = path.join(outputDir, `query_${engine}.js`);
  const entryContent = engine === "sql" ? createSqlEntry() : createGqlEntry();
  fs.writeFileSync(entryPath, entryContent);

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

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
      external: engine === "sql" ? ["tailordb"] : [],
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

  return fs.readFileSync(outputPath, "utf-8");
}
