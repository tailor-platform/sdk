export {};

declare global {
  namespace tailordb {
    type Row = string;
  }
}

type Rows<T> = tailordb.QueryResult<T>;
