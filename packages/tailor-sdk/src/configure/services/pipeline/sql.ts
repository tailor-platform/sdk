type execQuery = <T>(query: string, params?: readonly unknown[]) => Promise<T>;

export type SqlClient = {
  readonly exec: execQuery;
  readonly execOne: execQuery;
};
