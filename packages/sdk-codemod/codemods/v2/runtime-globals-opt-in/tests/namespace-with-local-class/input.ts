class tailordb {}

type Rows<T> = tailordb.QueryResult<T>;

export { tailordb };
export type { Rows };
