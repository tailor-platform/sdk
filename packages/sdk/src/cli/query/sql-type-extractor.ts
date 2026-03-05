import {
  astVisitor,
  parse,
  type From,
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
 * @param query - SQL query
 * @returns Type names with wildcard selection, empty if no wildcards
 */
export function extractWildcardTypeNames(query: string): string[] {
  try {
    const statements = parse(query);
    const result: string[] = [];

    const visitor = astVisitor(() => ({
      selection: (selection) => {
        if (!selection.columns) {
          return selection;
        }

        const wildcardAliases = extractWildcardAliases(selection.columns);
        if (wildcardAliases.length === 0) {
          return selection;
        }

        const fromClauses = ("from" in selection && selection.from) || [];
        const aliasMap = collectAliasMap(fromClauses as From[]);

        for (const alias of wildcardAliases) {
          if (alias === "*") {
            // Unqualified *: add all tables from FROM
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

        return selection;
      },
    }));

    for (const statement of statements) {
      visitor.statement(statement);
    }

    return result;
  } catch {
    return [];
  }
}
