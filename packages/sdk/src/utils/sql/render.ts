import { assertParsableExpression } from "#/utils/script-expr";
import { propertyKey, type SqlAnalysis, type SqlTypedName } from "./analyze";
import type { SqlQueryDefinition } from "#/runtime/sql";

const RUNTIME_MODULE = "@tailor-platform/sdk/runtime/sql";

function objectType(members: SqlTypedName[]): string {
  if (members.length === 0) return "Record<never, never>";
  return `{ ${members.map(({ name, type }) => `${propertyKey(name)}: ${type}`).join("; ")} }`;
}

/**
 * Render the TypeScript module a `.sql` import is typed as.
 * @param analysis - The analyzed statement, or undefined when the file has problems
 * @returns TypeScript source declaring the module's default export
 */
export function renderSqlDeclaration(analysis: SqlAnalysis | undefined): string {
  if (!analysis) {
    return [
      `import type { SqlClient } from "${RUNTIME_MODULE}";`,
      "declare const query: { readonly namespace: string; readonly sql: string; run(client: SqlClient, params?: Record<string, unknown>): Promise<any> };",
      "export default query;",
      "",
    ].join("\n");
  }
  return [
    `import type { SqlQuery } from "${RUNTIME_MODULE}";`,
    ...(analysis.usesTemporal
      ? ['import type { Temporal } from "@tailor-platform/sdk/runtime";']
      : []),
    `declare const query: SqlQuery<${objectType(analysis.params)}, ${objectType(analysis.columns)}, ${JSON.stringify(analysis.cardinality)}>;`,
    "export default query;",
    "",
  ].join("\n");
}

/**
 * Render the JavaScript module a `.sql` import is bundled as.
 * @param analysis - The analyzed statement
 * @returns JavaScript source whose default export runs the statement
 */
export function renderSqlModule(analysis: SqlAnalysis): string {
  const definition: SqlQueryDefinition = {
    namespace: analysis.namespace,
    sql: analysis.text,
    paramNames: analysis.paramNames,
    cardinality: analysis.cardinality,
  };
  const expression = assertParsableExpression(JSON.stringify(definition), "SQL query");
  return [
    `import { createSqlQuery } from "${RUNTIME_MODULE}";`,
    `export default createSqlQuery(${expression});`,
    "",
  ].join("\n");
}
