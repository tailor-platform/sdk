type execQuery = <T>(query: string) => Promise<T>;

type sqlClient = {
  readonly exec: execQuery;
  readonly execOne: execQuery;
};

export type sqlFactory<I, C> = ({
  client,
  input,
}: C & {
  client: sqlClient;
  input: I;
}) => ReturnType<execQuery>;
