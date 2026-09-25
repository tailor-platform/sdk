async function run<O>(): Promise<Tailordb.QueryResult<O>> {
  const cmd: Tailordb.CommandType = "SELECT";
  const client: Tailordb.Client = new (Tailordb.Client as typeof Tailordb.Client)({
    namespace: "demo",
  });
  void cmd;
  void client;
  return {} as Tailordb.QueryResult<O>;
}
