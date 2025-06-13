type execQuery = <T>(query: string) => Promise<T>;

type sqlClient = {
  readonly query: execQuery;
  readonly queryOne: execQuery;
};

export type sqlFactory<I, C> = ({
  client,
  input,
  context,
}: {
  client: sqlClient;
  input: I;
  context: C;
}) => ReturnType<execQuery>;
