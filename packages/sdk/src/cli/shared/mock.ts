// Mock tailordb Client for CLI environment
(
  globalThis as unknown as {
    tailordb: {
      Client: typeof tailordb.Client;
    };
  }
).tailordb = {
  Client: class {
    constructor(_config: { namespace: string }) {}
    async connect(): Promise<void> {}
    async end(): Promise<void> {}
    async queryObject<O>(): Promise<Tailordb.QueryResult<O>> {
      return {} as Promise<Tailordb.QueryResult<O>>;
    }
  },
};
