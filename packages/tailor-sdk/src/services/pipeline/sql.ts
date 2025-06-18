type execQuery = <T>(query: string) => Promise<T>;

type sqlClient = {
  readonly exec: execQuery;
  readonly execOne: execQuery;
};

export type sqlFactory<C> = (
  input: C & { client: sqlClient },
) => ReturnType<execQuery>;
