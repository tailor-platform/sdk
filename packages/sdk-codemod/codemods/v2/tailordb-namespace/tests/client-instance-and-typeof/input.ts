function takeClient(client: Tailordb.Client): void {
  void client;
}

function makeClient(Ctor: typeof Tailordb.Client): Tailordb.Client {
  return new Ctor({ namespace: "demo" });
}
