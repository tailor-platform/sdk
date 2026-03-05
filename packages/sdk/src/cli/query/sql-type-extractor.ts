import { astVisitor, parse, type SelectedColumn, type Statement } from "pgsql-ast-parser";

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

function isStarColumn(column: SelectedColumn): boolean {
  return column.expr.type === "ref" && column.expr.name === "*";
}

/**
 * Check if SQL query uses wildcard SELECT (*).
 * @param query - SQL query
 * @returns True if query contains SELECT *
 */
export function hasWildcardSelect(query: string): boolean {
  let found = false;

  try {
    const statements = parse(query);
    const visitor = astVisitor(() => ({
      selection: (selection) => {
        if (selection.columns?.some(isStarColumn)) {
          found = true;
        }
        return selection;
      },
    }));

    for (const statement of statements) {
      visitor.statement(statement);
    }
  } catch {
    return false;
  }

  return found;
}
