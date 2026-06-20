import "@tailor-platform/sdk/runtime/globals";

class tailordb {}

type Rows<T> = tailordb.QueryResult<T>;

export { tailordb };
export type { Rows };
