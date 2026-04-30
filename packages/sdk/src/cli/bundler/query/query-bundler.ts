import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { getDistDir } from "@/cli/shared/dist-dir";
import ml from "@/utils/multiline";
import type { QueryEngine } from "@/cli/query";

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
      if (!response.ok) {
        let message = \`HTTP \${response.status}\`;
        try {
          const errorJson = await response.json();
          if (errorJson && typeof errorJson === "object" && "message" in errorJson) {
            message = String(errorJson.message);
          }
        } catch {
          // Keep default HTTP status message when response body is not JSON.
        }
        throw new Error(\`GraphQL request failed: \${message}\`);
      }

      const json = await response.json();
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
  const entryContent = engine === "sql" ? createSqlEntry() : createGqlEntry();
  fs.writeFileSync(entryPath, entryContent);

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  const result = await rolldown.build({
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
  } as rolldown.BuildOptions);

  return result.output[0].code;
}
