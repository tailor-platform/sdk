import { astVisitor, parse, type From, type Statement } from "pgsql-ast-parser";

/**
 * Extract TailorDB type names from SQL query.
 * @param query - SQL query
 * @returns Type names referenced by query
 */
export function extractTypeNamesFromSql(query: string): string[] {
  let statements: Statement[];
  try {
    statements = parse(query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SQL parse error: ${message}\nIf your table name is a reserved keyword (e.g. User), wrap it in double quotes: SELECT * FROM "User"`,
      { cause: error },
    );
  }
  const typeNames = new Set<string>();

  const visitor = astVisitor((mapper) => ({
    tableRef: (tableRef) => {
      typeNames.add(tableRef.name);

      mapper.super().tableRef(tableRef);
      return tableRef;
    },
  }));

  for (const statement of statements) {
    visitor.statement(statement);
  }

  return [...typeNames];
}

function collectAliasMap(fromClauses: From[]): Map<string, string> {
  const aliasMap = new Map<string, string>();

  for (const from of fromClauses) {
    if (from.type === "table") {
      const tableName = from.name.name;
      const alias = from.name.alias ?? tableName;
      aliasMap.set(alias, tableName);
    }
  }

  return aliasMap;
}

export type ColumnSlot =
  | { type: "explicit"; name: string }
  | { type: "wildcard"; typeNames: string[] };

/**
 * Extract the column template from a SQL query's SELECT clause.
 * Returns an ordered list of column slots representing explicit columns
 * and wildcard expansions with their resolved type names.
 *
 * Only inspects the top-level SELECT statement, not subqueries.
 * TailorDB's sqlaccess does not currently support subqueries in FROM clauses,
 * but we intentionally avoid recursing into nested SELECTs to prevent
 * false positives if the parser accepts such queries.
 * @param query - SQL query
 * @returns Column slots if wildcards are present, null otherwise
 */
export function extractColumnTemplate(query: string): ColumnSlot[] | null {
  try {
    const statements = parse(query);

    for (const statement of statements) {
      if (statement.type !== "select" || !statement.columns) {
        continue;
      }

      const aliasMap = collectAliasMap(statement.from ?? []);
      const slots: ColumnSlot[] = [];
      let hasWildcard = false;

      for (const column of statement.columns) {
        if (column.expr.type === "ref" && column.expr.name === "*") {
          hasWildcard = true;
          if (column.expr.table) {
            const typeName = aliasMap.get(column.expr.table.name);
            slots.push({ type: "wildcard", typeNames: typeName ? [typeName] : [] });
          } else {
            slots.push({ type: "wildcard", typeNames: [...new Set(aliasMap.values())] });
          }
        } else {
          const name = column.alias?.name ?? (column.expr.type === "ref" ? column.expr.name : null);
          if (name) {
            slots.push({ type: "explicit", name });
          }
        }
      }

      return hasWildcard ? slots : null;
    }

    return null;
  } catch {
    return null;
  }
}
