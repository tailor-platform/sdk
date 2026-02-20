import * as nodeSqlParser from "node-sql-parser";
import type { AST } from "node-sql-parser";

const parserModule = (nodeSqlParser as { default?: unknown }).default ?? nodeSqlParser;
const { Parser } = parserModule as {
  Parser: new () => {
    astify(sql: string, opt?: { database?: string }): AST | AST[];
    tableList(sql: string, opt?: { database?: string }): string[];
  };
};

const sqlParser = new Parser();
const parserOption = { database: "postgresql" } as const;

function parseTypeNameFromTableListEntry(entry: string): string | null {
  const tableName = entry.split("::").at(-1);
  return tableName || null;
}

function collectCteNames(ast: AST | AST[]): Set<string> {
  const statements = Array.isArray(ast) ? ast : [ast];
  const cteNames = new Set<string>();

  for (const statement of statements) {
    if (!("with" in statement) || !Array.isArray(statement.with)) {
      continue;
    }

    for (const withStatement of statement.with) {
      const cteName = withStatement?.name?.value;
      if (cteName) {
        cteNames.add(cteName);
      }
    }
  }

  return cteNames;
}

/**
 * Extract TailorDB type names from SQL query.
 * Returns empty list when query cannot be parsed.
 * @param query - SQL query
 * @returns Type names referenced by query
 */
export function extractTypeNamesFromSql(query: string): string[] {
  try {
    const ast = sqlParser.astify(query, parserOption);
    const cteNames = collectCteNames(ast);
    const typeNames = new Set<string>();

    for (const entry of sqlParser.tableList(query, parserOption)) {
      const typeName = parseTypeNameFromTableListEntry(entry);
      if (!typeName || cteNames.has(typeName)) {
        continue;
      }

      typeNames.add(typeName);
    }

    return [...typeNames];
  } catch {
    return [];
  }
}
