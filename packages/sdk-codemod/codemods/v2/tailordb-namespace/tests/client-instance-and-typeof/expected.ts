function takeClient(client: tailordb.Client): void {
  void client;
}

function makeClient(Ctor: typeof tailordb.Client): tailordb.Client {
  return new Ctor({ namespace: "demo" });
}
