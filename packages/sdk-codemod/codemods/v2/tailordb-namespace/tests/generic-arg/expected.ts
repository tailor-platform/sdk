interface Row {
  id: string;
}

type RowsResult = tailordb.QueryResult<Row>;

function describe(result: tailordb.QueryResult<{ id: number; tags: readonly string[] }>): number {
  return result.rowCount;
}
