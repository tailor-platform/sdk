import {
  astVisitor,
  parse,
  type From,
  type SelectFromStatement,
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
      const selection = extractTopLevelSelect(statement);
      if (!selection?.columns) {
        continue;
      }

      const aliasMap = collectAliasMap(selection.from ?? []);
      const slots: ColumnSlot[] = [];
      let hasWildcard = false;

      for (const column of selection.columns) {
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
