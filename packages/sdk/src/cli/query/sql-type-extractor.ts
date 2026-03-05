import { astVisitor, parse, type Statement } from "pgsql-ast-parser";

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
