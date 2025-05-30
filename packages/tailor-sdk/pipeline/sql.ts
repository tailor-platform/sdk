
const execQuery = <T>(_strings: TemplateStringsArray, ..._values: any[]): Promise<T> => {
  return [] as unknown as Promise<T>;
}

const sqlClient = {
  query: execQuery,
  queryOne: execQuery,
} as const;

export type sqlFactory<I, C> = ({
  client,
  input,
  context
}: {
  client: typeof sqlClient
  input: I,
  context: C
}) => ReturnType<typeof execQuery>;
