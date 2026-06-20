import "@tailor-platform/sdk/runtime/globals";

type Rows<Row> = tailordb.QueryResult<Row>;

export type Result = Rows<{ id: string }>;
