export {};

declare global {
  namespace tailordb {
    type QueryResult<T> = T[];
  }
}

type Rows<T> = tailordb.QueryResult<T>;
