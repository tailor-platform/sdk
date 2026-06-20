declare namespace tailordb {
  export type Row = string;
}

declare namespace tailor {
  namespace idp {
    export type LocalUser = string;
  }
}

type Rows<T> = tailordb.QueryResult<T>;
type RuntimeUser = tailor.idp.User;
