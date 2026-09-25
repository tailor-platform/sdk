async function run<O>(): Promise<tailordb.QueryResult<O>> {
  const cmd: tailordb.CommandType = "SELECT";
  const client: tailordb.Client = new (tailordb.Client as typeof tailordb.Client)({
    namespace: "demo",
  });
  void cmd;
  void client;
  return {} as tailordb.QueryResult<O>;
}
