import "@tailor-platform/sdk/runtime/globals";

const tailordb = {};

type Rows<Row> = tailordb.QueryResult<Row>;

export { tailordb };
export type { Rows };
