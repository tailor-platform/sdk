import * as fs from "node:fs";
import { createRequire } from "node:module";
import ml from "multiline-ts";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { getDistDir } from "@/cli/utils/dist-dir";
import { CLIError } from "@/cli/utils/errors";
import type { QueryEngine } from "@/cli/query";

const REQUIRED_SQL_PACKAGES = ["kysely", "@tailor-platform/function-kysely-tailordb"] as const;

let sqlDependencyCheckDone = false;

function checkSqlDependencies(): void {
  if (sqlDependencyCheckDone) {
    return;
  }
  sqlDependencyCheckDone = true;

  const require = createRequire(path.resolve(process.cwd(), "package.json"));
  const missing: string[] = [];

  for (const pkg of REQUIRED_SQL_PACKAGES) {
    try {
      require.resolve(pkg);
    } catch {
      missing.push(pkg);
    }
  }

  if (missing.length > 0) {
    throw CLIError({
      code: "missing_dependency",
      message: "Missing required dependencies for SQL query execution.",
      details: missing.join(", "),
      suggestion: `Run: pnpm add -D ${missing.join(" ")}`,
    });
  }
}

function createSqlEntry(): string {
  return ml /* ts */ `
    import { Kysely, sql } from "kysely";
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
  if (engine === "sql") {
    checkSqlDependencies();
  }

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
