import {
  astVisitor,
  parse,
  type From,
  type SelectFromStatement,
  type SelectedColumn,
  type Statement,
} from "pgsql-ast-parser";

function collectCteNames(statements: Statement[]): Set<string> {
  const cteNames = new Set<string>();
  const visitor = astVisitor((mapper) => ({
    with: (statement) => {
      for (const binding of statement.bind) {
        cteNames.add(binding.alias.name);
      }
      mapper.super().with(statement);
      return statement;
    },
    withRecursive: (statement) => {
      cteNames.add(statement.alias.name);
      mapper.super().withRecursive(statement);
      return statement;
    },
  }));

  for (const statement of statements) {
    visitor.statement(statement);
  }

  return cteNames;
}

/**
 * Extract TailorDB type names from SQL query.
 * @param query - SQL query
 * @returns Type names referenced by query
 */
export function extractTypeNamesFromSql(query: string): string[] {
  const statements = parse(query);
  const typeNames = new Set<string>();

  const cteNames = collectCteNames(statements);
  const visitor = astVisitor((mapper) => ({
    tableRef: (tableRef) => {
      if (!cteNames.has(tableRef.name)) {
        typeNames.add(tableRef.name);
      }

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

    if (from.join) {
      const joinFrom = from.join;
      if ("on" in joinFrom || "using" in joinFrom) {
        // JoinClause doesn't directly contain From, but the joined table
        // is the next From in the array. Skip for now.
      }
    }
  }

  return aliasMap;
}

function extractWildcardAliases(columns: SelectedColumn[]): string[] {
  const aliases: string[] = [];

  for (const column of columns) {
    if (column.expr.type === "ref" && column.expr.name === "*") {
      if (column.expr.table) {
        aliases.push(column.expr.table.name);
      } else {
        aliases.push("*");
      }
    }
  }

  return aliases;
}

/**
 * Extract type names that have wildcard SELECT (*) in the query.
 * Handles both unqualified `*` and qualified `u.*` with alias resolution.
 *
 * Only inspects the top-level SELECT statement, not subqueries.
 * TailorDB's sqlaccess does not currently support subqueries in FROM clauses,
 * but we intentionally avoid recursing into nested SELECTs to prevent
 * false positives if the parser accepts such queries.
 * @param query - SQL query
 * @returns Type names with wildcard selection, empty if no wildcards
 */
export function extractWildcardTypeNames(query: string): string[] {
  try {
    const statements = parse(query);
    const result: string[] = [];

    for (const statement of statements) {
      const selection = extractTopLevelSelect(statement);
      if (!selection?.columns) {
        continue;
      }

      const wildcardAliases = extractWildcardAliases(selection.columns);
      if (wildcardAliases.length === 0) {
        continue;
      }

      const aliasMap = collectAliasMap(selection.from ?? []);

      for (const alias of wildcardAliases) {
        if (alias === "*") {
          for (const tableName of aliasMap.values()) {
            if (!result.includes(tableName)) {
              result.push(tableName);
            }
          }
        } else {
          const tableName = aliasMap.get(alias);
          if (tableName && !result.includes(tableName)) {
            result.push(tableName);
          }
        }
      }
    }

    return result;
  } catch {
    return [];
  }
}

/**
 * Extract the top-level SELECT from a statement, unwrapping WITH/CTE wrappers.
 * @param statement
 */
function extractTopLevelSelect(statement: Statement): SelectFromStatement | null {
  if (statement.type === "select") {
    return statement;
  }
  if (statement.type === "with" || statement.type === "with recursive") {
    const inner = statement.in;
    if (inner.type === "select") {
      return inner;
    }
  }
  return null;
}
