type execQuery = <T>(query: string) => Promise<T>;

export type SqlClient = {
  readonly exec: execQuery;
  readonly execOne: execQuery;
};

export type sqlFactory<C> = (
  input: C & { client: SqlClient },
) => ReturnType<execQuery>;
