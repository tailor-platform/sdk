import "@tailor-platform/sdk/runtime/globals";

function build(client = tailor) {
  var tailor = localClient;
  return client;
}

export { build };
