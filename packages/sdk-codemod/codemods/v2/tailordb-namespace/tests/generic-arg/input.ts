interface Row {
  id: string;
}

type RowsResult = Tailordb.QueryResult<Row>;

function describe(result: Tailordb.QueryResult<{ id: number; tags: readonly string[] }>): number {
  return result.rowCount;
}
