function build(client: typeof tailor): typeof tailor {
  var tailor = localClient;
  return client;
}

export { build };
